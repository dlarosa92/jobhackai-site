import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';

const DB_BINDING_NAMES = ['JOBHACKAI_DB', 'INTERVIEW_QUESTIONS_DB', 'IQ_D1', 'DB'];
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  const plan = (await env.JOBHACKAI_KV?.get(`planByUid:${uid}`)) || 'free';
  if (plan !== 'premium') return { ok: false, plan };
  return { ok: true, plan };
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

function safeJsonParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': env.FRONTEND_URL || 'https://dev.jobhackai.io',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        Vary: 'Origin'
      }
    });
  }

  if (request.method !== 'GET') {
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

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return jsonResponse(env, { error: 'invalid_request', field: 'id' }, 400);

  try {
    await ensureSchema(db);
    await cleanupOldRuns(db, uid);

    const row = await db
      .prepare(
        `SELECT id, created_at, updated_at, role, status, overall_score, output_json
         FROM linkedin_runs
         WHERE id = ? AND user_id = ?
         LIMIT 1`
      )
      .bind(id, uid)
      .first();

    if (!row) return jsonResponse(env, { error: 'not_found' }, 404);

    const output = safeJsonParse(row.output_json);
    if (!output) {
      return jsonResponse(
        env,
        { run_id: row.id, created_at: row.created_at, updated_at: row.updated_at, role: row.role, status: row.status || 'processing' },
        202
      );
    }

    return jsonResponse(env, {
      run_id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      role: row.role,
      ...output
    });
  } catch (e) {
    console.error('linkedin run error', e);
    return jsonResponse(env, { error: 'server_error', reason: e?.message || 'unknown' }, 500);
  }
}

