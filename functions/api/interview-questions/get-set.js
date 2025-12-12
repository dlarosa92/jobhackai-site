import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';

const DB_BINDING_NAMES = ['INTERVIEW_QUESTIONS_DB', 'IQ_D1', 'DB'];

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
      `CREATE TABLE IF NOT EXISTS interview_sets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role TEXT,
        seniority TEXT,
        types TEXT,
        jd TEXT,
        questions TEXT,
        selected_indices TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_interview_sets_user_created 
       ON interview_sets(user_id, created_at DESC)`
    )
    .run();
}

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function inferType(typesArr) {
  const valid = new Set(['mixed', 'behavioral', 'technical', 'leadership']);
  const cleaned = Array.isArray(typesArr)
    ? typesArr.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (!cleaned.length) return 'mixed';
  if (cleaned.includes('mixed')) return 'mixed';
  if (cleaned.length > 1) return 'mixed';
  if (cleaned[0] === 'system') return 'technical';
  if (cleaned[0] === 'culture') return 'behavioral';
  if (valid.has(cleaned[0])) return cleaned[0];
  return 'mixed';
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
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        'Access-Control-Allow-Origin': env.FRONTEND_URL || 'https://dev.jobhackai.io',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        Vary: 'Origin'
      }
    });
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

  const params = new URL(request.url).searchParams;
  const listMode = params.get('list');
  const id = params.get('id');

  if (!listMode && !id) {
    return jsonResponse(env, { error: 'invalid_request', reason: 'missing_list_or_id' }, 400);
  }

  try {
    await ensureSchema(db);

    if (listMode) {
      const rows = await db
        .prepare(
          `SELECT id, role, seniority, selected_indices, questions, created_at 
           FROM interview_sets 
           WHERE user_id = ? 
           ORDER BY created_at DESC 
           LIMIT 50`
        )
        .bind(uid)
        .all();

      const sets =
        rows?.results?.map((row) => {
          const selected = parseJsonArray(row.selected_indices);
          const questions = parseJsonArray(row.questions);
          return {
            id: row.id,
            role: row.role || '',
            seniority: row.seniority || '',
            createdAt: row.created_at || null,
            selectedCount: selected.length || questions.length || 0
          };
        }) || [];

      return jsonResponse(env, { success: true, sets });
    }

    // Detail fetch
    const row = await db
      .prepare(
        `SELECT id, role, seniority, types, jd, questions, selected_indices, created_at, updated_at 
         FROM interview_sets 
         WHERE id = ? AND user_id = ?`
      )
      .bind(id, uid)
      .first();

    if (!row) {
      return jsonResponse(env, { error: 'not_found' }, 404);
    }

    const questions = parseJsonArray(row.questions);
    const selectedIndices = parseJsonArray(row.selected_indices);
    const types = parseJsonArray(row.types);
    const type = inferType(types);

    return jsonResponse(env, {
      success: true,
      id: row.id,
      role: row.role || '',
      seniority: row.seniority || '',
      type,
      types,
      jd: row.jd || '',
      questions,
      selectedIndices,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    });
  } catch (e) {
    console.error('get-set error', e);
    return jsonResponse(env, { error: 'server_error', reason: e?.message || 'unknown' }, 500);
  }
}
