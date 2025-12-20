import { getBearer, verifyFirebaseIdToken } from '../../../_lib/firebase-auth.js';
import { getUserPlan } from '../../../_lib/db.js';

const DB_BINDING_NAMES = ['JOBHACKAI_DB', 'INTERVIEW_QUESTIONS_DB', 'IQ_D1', 'DB'];
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function jsonResponse(env, data, status = 200, originOverride = null) {
  const origin = originOverride || env.FRONTEND_URL || 'https://dev.jobhackai.io';
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      Vary: 'Origin'
    }
  });
}

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
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
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

export async function onRequest(context) {
  const { request, env, params } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'DELETE') {
    return jsonResponse(env, { error: 'method_not_allowed' }, 405, origin);
  }

  const db = getDb(env);
  if (!db) {
    return jsonResponse(env, { error: 'd1_not_bound' }, 500, origin);
  }

  const runId = params?.id ? String(params.id) : '';
  if (!runId) {
    return jsonResponse(env, { error: 'invalid_request', reason: 'missing_id' }, 400, origin);
  }

  const bearer = getBearer(request);
  if (!bearer) {
    return jsonResponse(env, { error: 'unauthorized' }, 401, origin);
  }

  let uid;
  try {
    const verified = await verifyFirebaseIdToken(bearer, env.FIREBASE_PROJECT_ID);
    uid = verified.uid;
  } catch (e) {
    return jsonResponse(env, { error: 'unauthorized', reason: e?.message || 'invalid_token' }, 401, origin);
  }

  const authz = await requirePremium(env, uid);
  if (!authz.ok) {
    return jsonResponse(env, { error: 'premium_required' }, 403, origin);
  }

  try {
    await ensureSchema(db);

    const ownedRun = await db
      .prepare(`SELECT id FROM linkedin_runs WHERE id = ? AND user_id = ?`)
      .bind(runId, uid)
      .first();
    if (!ownedRun) {
      return jsonResponse(env, { error: 'not_found' }, 404, origin);
    }

    const result = await db
      .prepare(`DELETE FROM linkedin_runs WHERE id = ? AND user_id = ?`)
      .bind(runId, uid)
      .run();

    const changes =
      typeof result?.meta?.changes === 'number'
        ? result.meta.changes
        : typeof result?.changes === 'number'
          ? result.changes
          : 0;

    if (changes === 0) {
      return jsonResponse(env, { error: 'not_found' }, 404, origin);
    }

    return jsonResponse(env, { success: true }, 200, origin);
  } catch (e) {
    console.error('[LINKEDIN HISTORY DELETE] Error:', e);
    return jsonResponse(env, { error: 'server_error', reason: e?.message || 'unknown' }, 500, origin);
  }
}

