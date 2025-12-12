import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';
import { callOpenAI } from '../../../app/functions/_lib/openai-client.js';

const DB_BINDING_NAMES = ['INTERVIEW_QUESTIONS_DB', 'IQ_D1', 'DB'];

function jsonResponse(env, data, status = 200) {
  const origin = env.FRONTEND_URL || 'https://dev.jobhackai.io';
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      Vary: 'Origin'
    }
  });
}

function getDb(env) {
  for (const name of DB_BINDING_NAMES) {
    const candidate = env[name];
    if (candidate && typeof candidate.prepare === 'function') return candidate;
  }
  return null;
}

async function ensureSchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS cover_letter_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        role TEXT NOT NULL,
        company TEXT NULL,
        seniority TEXT NOT NULL,
        tone TEXT NOT NULL,
        job_description TEXT NOT NULL,
        resume_text TEXT NULL,
        cover_letter_text TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        is_deleted INTEGER NOT NULL DEFAULT 0
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_cover_letter_user_created
       ON cover_letter_history(user_id, created_at DESC)`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_cover_letter_user_hash
       ON cover_letter_history(user_id, input_hash)`
    )
    .run();
}

async function requireProOrPremium(env, uid) {
  const plan = (await env.JOBHACKAI_KV?.get(`planByUid:${uid}`)) || 'free';
  if (plan !== 'pro' && plan !== 'premium') {
    return { ok: false, plan };
  }
  return { ok: true, plan };
}

function normalizeWhitespace(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampText(s, maxLen) {
  const str = String(s || '');
  if (!maxLen || maxLen <= 0) return str;
  return str.length <= maxLen ? str : str.slice(0, maxLen);
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildTitle(role, company) {
  const r = String(role || '').trim();
  const c = String(company || '').trim();
  const base = c ? `${r} — ${c}` : r;
  return clampText(base || 'Cover Letter', 120);
}

function buildCoverLetterPrompt({ role, company, seniority, tone, jobDescription, resumeText }) {
  const companyLine = company ? `Company: ${company}\n` : '';
  const resumeBlock = resumeText ? `\nResume (paste):\n${resumeText}\n` : '';
  return (
    `Write an ATS-friendly cover letter (250–350 words) for the following application.\n` +
    `Constraints:\n` +
    `- Do NOT invent metrics, numbers, companies, titles, or achievements.\n` +
    `- Only use information explicitly provided.\n` +
    `- Use a confident, professional tone unless a different tone is specified.\n` +
    `- Format as plain text with paragraphs (no markdown headers).\n\n` +
    `Target Role: ${role}\n` +
    companyLine +
    `Seniority: ${seniority}\n` +
    `Tone: ${tone}\n\n` +
    `Job Description:\n${jobDescription}\n` +
    resumeBlock
  );
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': env.FRONTEND_URL || 'https://dev.jobhackai.io',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        Vary: 'Origin'
      }
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(env, { error: 'method_not_allowed' }, 405);
  }

  const db = getDb(env);
  if (!db) {
    return jsonResponse(env, { error: 'd1_not_bound' }, 500);
  }

  const bearer = getBearer(request);
  if (!bearer) {
    return jsonResponse(env, { error: 'unauthorized' }, 401);
  }

  let uid;
  try {
    const verified = await verifyFirebaseIdToken(bearer, env.FIREBASE_PROJECT_ID);
    uid = verified.uid;
  } catch (e) {
    return jsonResponse(env, { error: 'unauthorized', reason: e?.message || 'invalid_token' }, 401);
  }

  const authz = await requireProOrPremium(env, uid);
  if (!authz.ok) {
    return jsonResponse(env, { error: 'not_authorized' }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(env, { error: 'invalid_json' }, 400);
  }

  const roleRaw = payload?.role;
  const companyRaw = payload?.company;
  const seniorityRaw = payload?.seniority;
  const toneRaw = payload?.tone ?? 'Confident + Professional';
  const jobDescRaw = payload?.jobDescription;
  const resumeTextRaw = payload?.resumeText ?? '';

  const role = clampText(normalizeWhitespace(roleRaw), 120);
  const company = clampText(normalizeWhitespace(companyRaw), 120);
  const seniority = clampText(normalizeWhitespace(seniorityRaw), 40);
  const tone = clampText(normalizeWhitespace(toneRaw) || 'Confident + Professional', 60);

  // Keep user formatting for generation, but trim and cap to avoid abuse.
  const jobDescription = clampText(String(jobDescRaw || '').trim(), 8000);
  const resumeText = clampText(String(resumeTextRaw || '').trim(), 12000);

  const validSeniorities = new Set(['Intern', 'Junior', 'Mid', 'Senior', 'Lead', 'Director']);
  const validTones = new Set(['Confident + Professional', 'Direct + No-Fluff', 'Warm + Human']);

  if (!role) return jsonResponse(env, { error: 'invalid_request', field: 'role' }, 400);
  if (!seniority || !validSeniorities.has(seniority)) return jsonResponse(env, { error: 'invalid_request', field: 'seniority' }, 400);
  if (!jobDescription) return jsonResponse(env, { error: 'invalid_request', field: 'jobDescription' }, 400);
  if (tone && !validTones.has(tone)) return jsonResponse(env, { error: 'invalid_request', field: 'tone' }, 400);

  try {
    await ensureSchema(db);

    const inputHash = await sha256Hex(
      [
        uid,
        normalizeWhitespace(role),
        normalizeWhitespace(company),
        normalizeWhitespace(seniority),
        normalizeWhitespace(tone),
        normalizeWhitespace(jobDescription),
        normalizeWhitespace(resumeText)
      ].join('|')
    );

    const existing = await db
      .prepare(
        `SELECT
          id,
          created_at,
          updated_at,
          title,
          role,
          company,
          seniority,
          tone,
          job_description,
          resume_text,
          cover_letter_text,
          input_hash
        FROM cover_letter_history
        WHERE user_id = ? AND input_hash = ? AND is_deleted = 0
        LIMIT 1`
      )
      .bind(uid, inputHash)
      .first();

    if (existing) {
      return jsonResponse(env, {
        success: true,
        item: {
          id: existing.id,
          userId: uid,
          createdAt: existing.created_at,
          updatedAt: existing.updated_at,
          title: existing.title,
          role: existing.role,
          company: existing.company || '',
          seniority: existing.seniority,
          tone: existing.tone,
          jobDescription: existing.job_description,
          resumeText: existing.resume_text || '',
          coverLetterText: existing.cover_letter_text,
          inputHash: existing.input_hash
        },
        deduped: true
      });
    }

    const prompt = buildCoverLetterPrompt({
      role,
      company,
      seniority,
      tone,
      jobDescription,
      resumeText
    });

    const result = await callOpenAI(
      {
        model: 'gpt-4o-mini',
        fallbackModel: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert career coach and recruiter. You write concise, ATS-friendly cover letters that are specific and honest.'
          },
          { role: 'user', content: prompt }
        ],
        maxTokens: 800,
        temperature: 0.4,
        systemPrompt: 'cover_letter_generator_v1',
        userId: uid,
        feature: 'cover_letter'
      },
      env
    );

    const coverLetterText = String(result?.content || '').trim();
    if (!coverLetterText) {
      return jsonResponse(env, { error: 'generation_failed', reason: 'empty_response' }, 500);
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const title = buildTitle(role, company);

    await db
      .prepare(
        `INSERT INTO cover_letter_history
          (id, user_id, created_at, updated_at, title, role, company, seniority, tone, job_description, resume_text, cover_letter_text, input_hash, is_deleted)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .bind(
        id,
        uid,
        now,
        now,
        title,
        role,
        company || null,
        seniority,
        tone,
        jobDescription,
        resumeText || null,
        coverLetterText,
        inputHash
      )
      .run();

    return jsonResponse(env, {
      success: true,
      item: {
        id,
        userId: uid,
        createdAt: now,
        updatedAt: now,
        title,
        role,
        company: company || '',
        seniority,
        tone,
        jobDescription,
        resumeText: resumeText || '',
        coverLetterText,
        inputHash
      },
      deduped: false
    });
  } catch (e) {
    console.error('cover-letter generate error', e);
    return jsonResponse(env, { error: 'server_error', reason: e?.message || 'unknown' }, 500);
  }
}

