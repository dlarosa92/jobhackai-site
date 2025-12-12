/**
 * Cover Letter History Item endpoint
 * PATCH /api/cover-letter/history/:id
 * DELETE /api/cover-letter/history/:id
 *
 * Pro/Premium only.
 */

import { getBearer, verifyFirebaseIdToken } from '../../../_lib/firebase-auth.js';

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
    'Access-Control-Allow-Methods': 'PATCH, DELETE, OPTIONS',
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

function clampText(s, maxLen) {
  const str = String(s || '');
  if (!maxLen || maxLen <= 0) return str;
  return str.length <= maxLen ? str : str.slice(0, maxLen);
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const id = params?.id ? String(params.id) : '';
  if (!id) {
    return json(origin, { error: 'invalid_request', reason: 'missing_id' }, 400);
  }

  if (request.method !== 'PATCH' && request.method !== 'DELETE') {
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

  try {
    await ensureSchema(db);

    if (request.method === 'DELETE') {
      const now = Date.now();
      const res = await db
        .prepare(
          `UPDATE cover_letter_history
           SET is_deleted = 1, updated_at = ?
           WHERE id = ? AND user_id = ? AND is_deleted = 0`
        )
        .bind(now, id, uid)
        .run();

      // If D1 reports an operation failure, return an error immediately
      if (!res || res.success === false) {
        return json(origin, { error: 'operation_failed', reason: 'database_error' }, 500);
      }

      const changes =
        typeof res?.meta?.changes === 'number'
          ? res.meta.changes
          : typeof res?.changes === 'number'
            ? res.changes
            : null;

      // If UPDATE succeeded but matched 0 rows, check if row exists to determine if it's 404
      if (changes === 0) {
        const row = await db
          .prepare(`SELECT id FROM cover_letter_history WHERE id = ? AND user_id = ? AND is_deleted = 0`)
          .bind(id, uid)
          .first();
        if (!row) return json(origin, { error: 'not_found' }, 404);
        // If row exists but wasn't updated, something unexpected happened
        return json(origin, { error: 'operation_failed', reason: 'update_mismatch' }, 500);
      }

      return json(origin, { success: true });
    }

    // PATCH: rename and/or autosave edits
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json(origin, { error: 'invalid_json' }, 400);
    }

    const title = payload?.title !== undefined ? clampText(String(payload.title || '').trim(), 120) : null;
    const coverLetterText =
      payload?.coverLetterText !== undefined ? clampText(String(payload.coverLetterText || ''), 20000) : null;

    if (title === null && coverLetterText === null) {
      return json(origin, { error: 'invalid_request', reason: 'no_fields' }, 400);
    }

    const now = Date.now();

    if (title !== null && coverLetterText !== null) {
      await db
        .prepare(
          `UPDATE cover_letter_history
           SET title = ?, cover_letter_text = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND is_deleted = 0`
        )
        .bind(title || 'Cover Letter', coverLetterText, now, id, uid)
        .run();
    } else if (title !== null) {
      await db
        .prepare(
          `UPDATE cover_letter_history
           SET title = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND is_deleted = 0`
        )
        .bind(title || 'Cover Letter', now, id, uid)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE cover_letter_history
           SET cover_letter_text = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND is_deleted = 0`
        )
        .bind(coverLetterText, now, id, uid)
        .run();
    }

    const row = await db
      .prepare(
        `SELECT id, created_at, updated_at, title, role, company, seniority, tone, job_description, resume_text, cover_letter_text, input_hash
         FROM cover_letter_history
         WHERE id = ? AND user_id = ? AND is_deleted = 0
         LIMIT 1`
      )
      .bind(id, uid)
      .first();

    if (!row) {
      return json(origin, { error: 'not_found' }, 404);
    }

    return json(origin, {
      success: true,
      item: {
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
      }
    });
  } catch (e) {
    console.error('cover-letter history id error', e);
    return json(origin, { error: 'server_error', reason: e?.message || 'unknown' }, 500);
  }
}


