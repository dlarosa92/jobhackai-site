/**
 * Cover Letter History endpoint
 * GET /api/cover-letter/history?limit=25
 *
 * Returns the user's past cover letters from D1.
 * Pro/Premium only.
 */

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';

const DB_BINDING_NAMES = ['JOBHACKAI_DB', 'INTERVIEW_QUESTIONS_DB', 'IQ_D1', 'DB'];

function corsHeaders(origin) {
  const allowedOrigins = [
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io',
    'https://app.jobhackai.io',
    'http://localhost:3003',
    'http://localhost:8788'
  ];
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(origin, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin)
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

async function getUserPlan(uid, env) {
  if (!env.JOBHACKAI_KV) return 'free';
  const plan = await env.JOBHACKAI_KV.get(`planByUid:${uid}`);
  return plan || 'free';
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'GET') {
    return json(origin, { error: 'method_not_allowed' }, 405);
  }

  const db = getDb(env);
  if (!db) {
    return json(origin, { error: 'd1_not_bound' }, 500);
  }

  const token = getBearer(request);
  if (!token) {
    return json(origin, { error: 'unauthorized' }, 401);
  }

  let uid;
  try {
    const verified = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    uid = verified.uid;
  } catch (e) {
    return json(origin, { error: 'unauthorized', reason: e?.message || 'invalid_token' }, 401);
  }

  const plan = await getUserPlan(uid, env);
  if (plan !== 'pro' && plan !== 'premium') {
    return json(origin, { error: 'not_authorized' }, 403);
  }

  const params = new URL(request.url).searchParams;
  const limitRaw = params.get('limit');
  const limit = Math.max(1, Math.min(100, Number.parseInt(limitRaw || '25', 10) || 25));

  try {
    await ensureSchema(db);

    const rows = await db
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
        WHERE user_id = ? AND is_deleted = 0
        ORDER BY created_at DESC
        LIMIT ?`
      )
      .bind(uid, limit)
      .all();

    const items =
      rows?.results?.map((row) => ({
        id: row.id,
        userId: uid,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        title: row.title,
        role: row.role,
        company: row.company || '',
        seniority: row.seniority,
        tone: row.tone,
        jobDescription: row.job_description,
        resumeText: row.resume_text || '',
        coverLetterText: row.cover_letter_text,
        inputHash: row.input_hash
      })) || [];

    return json(origin, { success: true, items });
  } catch (e) {
    console.error('cover-letter history error', e);
    return json(origin, { error: 'server_error', reason: e?.message || 'unknown' }, 500);
  }
}


