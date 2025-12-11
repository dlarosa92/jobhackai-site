import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';

const DB_BINDING_NAMES = ['INTERVIEW_QUESTIONS_DB', 'IQ_D1', 'DB'];
const PLAN_LIMITS = {
  trial: { maxSets: 1, dailySaves: 1 },
  essential: { maxSets: 3, dailySaves: 3 },
  pro: { maxSets: 20, dailySaves: 30 },
  premium: { maxSets: 200, dailySaves: 200 },
  free: { maxSets: 0, dailySaves: 0 }
};

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

async function getPlan(env, uid) {
  try {
    const plan = await env.JOBHACKAI_KV?.get(`planByUid:${uid}`);
    return plan || 'free';
  } catch {
    return 'free';
  }
}

function normalizeQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => {
      if (typeof q === 'string') return q.trim();
      if (q && typeof q.q === 'string') return q.q.trim();
      return '';
    })
    .filter((q) => q.length > 0);
}

function normalizeSelectedIndices(raw, max) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < max);
}

function safeArray(raw, limit = 10, maxLen = 40) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((v) => v.slice(0, maxLen));
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
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        'Access-Control-Allow-Origin': env.FRONTEND_URL || 'https://dev.jobhackai.io',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(env, { error: 'invalid_json' }, 400);
  }

  const role = String(payload?.role || '').trim().slice(0, 120);
  const seniority = String(payload?.seniority || '').trim().slice(0, 40);
  const jd = String(payload?.jd || '').trim().slice(0, 4000);
  const questions = normalizeQuestions(payload?.questions);
  const types = safeArray(payload?.types, 10, 40);
  const selectedIndices = normalizeSelectedIndices(payload?.selectedIndices, questions.length);

  if (!questions.length) {
    return jsonResponse(env, { error: 'invalid_questions', reason: 'missing' }, 400);
  }
  if (questions.length > 20) {
    return jsonResponse(env, { error: 'invalid_questions', reason: 'too_many' }, 400);
  }

  const fetchedPlan = await getPlan(env, uid);
  const plan = PLAN_LIMITS[fetchedPlan] ? fetchedPlan : 'free';
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  try {
    await ensureSchema(db);

    const totalRow = await db
      .prepare('SELECT COUNT(*) AS c FROM interview_sets WHERE user_id = ?')
      .bind(uid)
      .first();
    const dailyRow = await db
      .prepare('SELECT COUNT(*) AS c FROM interview_sets WHERE user_id = ? AND created_at > ?')
      .bind(uid, Date.now() - 86_400_000)
      .first();

    const totalCount = Number(totalRow?.c || 0);
    const dailyCount = Number(dailyRow?.c || 0);

    if (Number.isFinite(limits.maxSets) && (limits.maxSets <= 0 || totalCount >= limits.maxSets)) {
      return jsonResponse(env, { error: 'limit', reason: 'max_sets' }, 429);
    }
    if (Number.isFinite(limits.dailySaves) && (limits.dailySaves <= 0 || dailyCount >= limits.dailySaves)) {
      return jsonResponse(env, { error: 'limit', reason: 'daily_limit' }, 429);
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const selectedJson = JSON.stringify(selectedIndices);
    const questionsJson = JSON.stringify(questions);
    const typesJson = JSON.stringify(types);

    await db
      .prepare(
        `INSERT INTO interview_sets 
        (id, user_id, role, seniority, types, jd, questions, selected_indices, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, uid, role, seniority, typesJson, jd, questionsJson, selectedJson, now, now)
      .run();

    return jsonResponse(env, {
      success: true,
      id,
      createdAt: now,
      selectedCount: selectedIndices.length || questions.length
    });
  } catch (e) {
    console.error('save-set error', e);
    return jsonResponse(env, { error: 'server_error', reason: e?.message || 'unknown' }, 500);
  }
}
