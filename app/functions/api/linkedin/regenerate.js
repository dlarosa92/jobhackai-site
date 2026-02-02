import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';
import { callOpenAI } from '../../_lib/openai-client.js';
import { getUserPlan } from '../../_lib/db.js';

const DB_BINDING_NAMES = ['JOBHACKAI_DB', 'INTERVIEW_QUESTIONS_DB', 'IQ_D1', 'DB'];

const MAX = {
  requestId: 80,
  runId: 80
};

const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

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
      `CREATE TABLE IF NOT EXISTS linkedin_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        role TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'processing',
        overall_score INTEGER,
        input_json TEXT NOT NULL,
        output_json TEXT,
        model TEXT,
        tokens_in INTEGER,
        tokens_out INTEGER,
        error_message TEXT,
        is_pinned INTEGER NOT NULL DEFAULT 0
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_linkedin_runs_user_created
       ON linkedin_runs(user_id, created_at DESC)`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_linkedin_runs_user_hash
       ON linkedin_runs(user_id, input_hash)`
    )
    .run();
}

async function requirePremium(env, uid) {
  const plan = await getUserPlan(env, uid);
  if (plan !== 'premium') return { ok: false, plan };
  return { ok: true, plan };
}

function normalizeWhitespace(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampText(s, maxLen) {
  const str = String(s ?? '');
  if (!maxLen || maxLen <= 0) return str;
  return str.length <= maxLen ? str : str.slice(0, maxLen);
}

function safeJsonParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sectionSchema() {
  return {
    type: 'object',
    properties: {
      score: { type: 'number' },
      label: { type: 'string' },
      feedbackBullets: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
      optimizedText: { type: 'string' }
    },
    required: ['score', 'label', 'feedbackBullets', 'optimizedText'],
    additionalProperties: false
  };
}

function regenerateResponseSchema() {
  return {
    name: 'linkedin_optimizer_regenerate_v1',
    schema: {
      type: 'object',
      properties: {
        overallScore: { type: 'number' },
        section: { type: 'string', enum: ['headline', 'summary', 'experience', 'skills', 'recommendations'] },
        data: sectionSchema()
      },
      required: ['overallScore', 'section', 'data'],
      additionalProperties: false
    }
  };
}

function buildRegenerateMessages({ role, headline, summary, experience, skills, recommendations }, currentOutput, sectionKey) {
  const system = `You are JobHackAI's LinkedIn Profile Optimizer.
Return STRICT JSON only (no markdown, no commentary).

Task:
- Regenerate ONLY the requested section while keeping voice and details consistent across the profile.
- Do NOT invent achievements or metrics.

Rules:
- feedbackBullets: 2-3 items max.
- Keep optimizedText paste-ready for LinkedIn.

Length caps:
- headline optimizedText <= 220 chars
- summary optimizedText <= 1200 chars
- experience optimizedText <= 1200 chars total
- skills optimizedText <= 350 chars`;

  const user =
    `TARGET ROLE: ${role}\n\n` +
    `ORIGINAL INPUT:\n` +
    `headline: ${headline}\n` +
    `summary: ${summary}\n` +
    `experience: ${experience}\n` +
    `skills: ${skills}\n` +
    (recommendations ? `recommendations: ${recommendations}\n` : '') +
    `\nCURRENT OUTPUT (for consistency):\n${JSON.stringify(currentOutput || {})}\n\n` +
    `REGENERATE SECTION: ${sectionKey}\n\n` +
    `Return JSON: { overallScore:number, section:"${sectionKey}", data:{ score:number, label:string, feedbackBullets:string[], optimizedText:string } }`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

async function cleanupOldRuns(db, uid) {
  const cutoff = Date.now() - RETENTION_MS;
  await db
    .prepare(
      `DELETE FROM linkedin_runs
       WHERE user_id = ? AND is_pinned = 0 AND created_at < ?`
    )
    .bind(uid, cutoff)
    .run();
}

function validateRegenerateOutput(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.overallScore !== 'number') return false;
  if (typeof obj.section !== 'string') return false;
  if (!obj.data || typeof obj.data !== 'object') return false;
  if (typeof obj.data.score !== 'number') return false;
  if (typeof obj.data.label !== 'string') return false;
  if (!Array.isArray(obj.data.feedbackBullets)) return false;
  if (typeof obj.data.optimizedText !== 'string') return false;
  return true;
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
  if (!db) return jsonResponse(env, { error: 'd1_not_bound' }, 500);

  const bearer = getBearer(request);
  if (!bearer) return jsonResponse(env, { error: 'unauthorized' }, 401);

  let uid;
  try {
    const verified = await verifyFirebaseIdToken(bearer, env.FIREBASE_PROJECT_ID);
    uid = verified.uid;
  } catch (e) {
    return jsonResponse(env, { error: 'unauthorized', reason: e?.message || 'invalid_token' }, 401);
  }

  const authz = await requirePremium(env, uid);
  if (!authz.ok) return jsonResponse(env, { error: 'premium_required' }, 403);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(env, { error: 'invalid_json' }, 400);
  }

  const requestId = clampText(normalizeWhitespace(payload?.request_id), MAX.requestId);
  const runId = clampText(normalizeWhitespace(payload?.run_id), MAX.runId);
  const section = String(payload?.section || '').trim();
  const allowed = new Set(['headline', 'summary', 'experience', 'skills', 'recommendations']);

  if (!requestId) return jsonResponse(env, { error: 'invalid_request', field: 'request_id' }, 400);
  if (!runId) return jsonResponse(env, { error: 'invalid_request', field: 'run_id' }, 400);
  if (!allowed.has(section)) return jsonResponse(env, { error: 'invalid_request', field: 'section' }, 400);

  try {
    await ensureSchema(db);
    await cleanupOldRuns(db, uid);

    // Idempotency: if request_id already exists, return the latest matching run (per user)
    const existingByRequest = await db
      .prepare(
        `SELECT id, created_at, updated_at, role, status, output_json
         FROM linkedin_runs
         WHERE request_id = ? AND user_id = ?
         LIMIT 1`
      )
      .bind(requestId, uid)
      .first();

    if (existingByRequest) {
      const output = safeJsonParse(existingByRequest.output_json);
      if (existingByRequest.status === 'ok' && output) {
        const sec = output?.sections?.[section];
        return jsonResponse(env, {
          run_id: existingByRequest.id,
          updated_at: existingByRequest.updated_at,
          overallScore: output?.overallScore ?? null,
          section,
          data: sec || null,
          deduped: true
        });
      }
      // Return early for processing/error states to avoid UNIQUE constraint violation
      return jsonResponse(
        env,
        {
          run_id: existingByRequest.id,
          created_at: existingByRequest.created_at,
          updated_at: existingByRequest.updated_at,
          role: existingByRequest.role,
          status: existingByRequest.status || 'processing'
        },
        202
      );
    }

    // Load the source run (must belong to user)
    const row = await db
      .prepare(
        `SELECT id, created_at, updated_at, role, input_hash, input_json, output_json, status
         FROM linkedin_runs
         WHERE id = ? AND user_id = ?
         LIMIT 1`
      )
      .bind(runId, uid)
      .first();

    if (!row) return jsonResponse(env, { error: 'not_found' }, 404);

    const input = safeJsonParse(row.input_json);
    const currentOutput = safeJsonParse(row.output_json);
    if (!input || !currentOutput) {
      return jsonResponse(env, { error: 'invalid_state', reason: 'missing_input_or_output' }, 409);
    }

    if (section === 'recommendations' && !input.recommendations) {
      return jsonResponse(env, { error: 'invalid_request', field: 'section', reason: 'recommendations_not_provided' }, 400);
    }

    // Create a new run for this regenerate operation (keeps request_id uniqueness and preserves history)
    const nextRunId = crypto.randomUUID();
    const now = Date.now();
    const role = String(input.role || row.role || '').trim();
    const inputHashFromRow = String(row.input_hash || '').trim();
    const resolvedInputHash =
      inputHashFromRow ||
      (await sha256Hex(
        [
          uid,
          normalizeWhitespace(input.role),
          normalizeWhitespace(input.headline),
          normalizeWhitespace(input.summary),
          normalizeWhitespace(input.experience),
          normalizeWhitespace(input.skills),
          normalizeWhitespace(input.recommendations || '')
        ].join('|')
      ));

    await db
      .prepare(
        `INSERT INTO linkedin_runs
          (id, user_id, created_at, updated_at, role, input_hash, request_id, status, input_json, is_pinned)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, 'processing', ?, 0)`
      )
      .bind(nextRunId, uid, now, now, role, resolvedInputHash, requestId, JSON.stringify(input))
      .run();

    let aiResult;
    try {
      aiResult = await callOpenAI(
        {
          model: env.OPENAI_MODEL_LINKEDIN_REGENERATE || 'gpt-4o-mini',
          fallbackModel: 'gpt-4o-mini',
          messages: buildRegenerateMessages(input, currentOutput, section),
          responseFormat: regenerateResponseSchema(),
          maxTokens: Number(env.OPENAI_MAX_TOKENS_LINKEDIN_REGENERATE) > 0 ? Number(env.OPENAI_MAX_TOKENS_LINKEDIN_REGENERATE) : 900,
          temperature: Number.isFinite(Number(env.OPENAI_TEMPERATURE_LINKEDIN_REGENERATE))
            ? Number(env.OPENAI_TEMPERATURE_LINKEDIN_REGENERATE)
            : 0.35,
          systemPrompt: 'linkedin_optimizer_regenerate_v1',
          userId: uid,
          feature: 'linkedin_optimizer_regenerate'
        },
        env
      );
    } catch (e) {
      const msg = e?.message || 'openai_error';
      await db
        .prepare(
          `UPDATE linkedin_runs
           SET status = 'error', error_message = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
        .bind(msg, Date.now(), nextRunId, uid)
        .run();
      throw e;
    }

    const out = safeJsonParse(aiResult?.content);
    if (!validateRegenerateOutput(out) || out.section !== section) {
      const msg = 'invalid_ai_json';
      await db
        .prepare(
          `UPDATE linkedin_runs
           SET status = 'error', error_message = ?, updated_at = ?, model = ?, tokens_in = ?, tokens_out = ?
           WHERE id = ? AND user_id = ?`
        )
        .bind(
          msg,
          Date.now(),
          aiResult?.model || null,
          aiResult?.usage?.promptTokens || null,
          aiResult?.usage?.completionTokens || null,
          nextRunId,
          uid
        )
        .run();
      return jsonResponse(env, { error: 'generation_failed', reason: msg }, 500);
    }

    // Patch output_json in-place
    const next = { ...currentOutput };
    next.sections = { ...(currentOutput.sections || {}) };
    next.sections[section] = out.data;

    // --- Normalize section scores and compute weighted overall (server authoritative) ---
    const WEIGHTS = {
      headline: 20,
      summary: 30,
      experience: 25,
      skills: 15,
      recommendations: 10
    };

    function normalizeTo100(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return null;
      if (n < 0) return 0;
      if (n <= 10) return Math.round(n * 10);
      return Math.round(Math.max(0, Math.min(100, n)));
    }

    let seenSmallScale = false;
    let weightSum = 0;
    let weightedSum = 0;
    if (next.sections && typeof next.sections === 'object') {
      for (const [k, sec] of Object.entries(next.sections)) {
        if (sec && typeof sec.score === 'number') {
          const originalScore = sec.score;
          const norm = normalizeTo100(originalScore);
          if (norm === null) {
            console.warn('[LINKEDIN] section score not numeric for', k, originalScore);
          } else {
            if (originalScore <= 10) seenSmallScale = true;
            next.sections[k].score = norm;
            if (Object.prototype.hasOwnProperty.call(WEIGHTS, k)) {
              weightSum += WEIGHTS[k];
              weightedSum += norm * WEIGHTS[k];
            }
          }
        }
      }
    }

    let computedOverall = null;
    if (weightSum > 0) {
      computedOverall = Math.round(weightedSum / weightSum);
    }

    const overallScore = computedOverall !== null ? computedOverall : null;
    next.overallScore = overallScore;

    if (seenSmallScale) {
      console.info('[LINKEDIN] AI appears to return 0-10 scale for section scores; normalized to 0-100', {
        runId: nextRunId,
        detectedSections: Object.keys(next.sections || {})
      });
    }

    const updatedAt = Date.now();

    await db
      .prepare(
        `UPDATE linkedin_runs
         SET status = 'ok',
             overall_score = ?,
             output_json = ?,
             updated_at = ?,
             model = ?,
             tokens_in = ?,
             tokens_out = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(
        overallScore,
        JSON.stringify(next),
        updatedAt,
        aiResult?.model || null,
        aiResult?.usage?.promptTokens || null,
        aiResult?.usage?.completionTokens || null,
        nextRunId,
        uid
      )
      .run();

    return jsonResponse(env, {
      run_id: nextRunId,
      updated_at: updatedAt,
      overallScore: next.overallScore,
      section,
      data: next.sections[section],
      deduped: false
    });
  } catch (e) {
    console.error('linkedin regenerate error', e);
    return jsonResponse(env, { error: 'server_error', reason: e?.message || 'unknown' }, 500);
  }
}
