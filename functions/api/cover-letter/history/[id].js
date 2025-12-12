import { getBearer, verifyFirebaseIdToken } from '../../../_lib/firebase-auth';

const DB_BINDING_NAMES = ['INTERVIEW_QUESTIONS_DB', 'IQ_D1', 'DB'];

function jsonResponse(env, data, status = 200) {
  const origin = env.FRONTEND_URL || 'https://dev.jobhackai.io';
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'PATCH, DELETE, OPTIONS',
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

function clampText(s, maxLen) {
  const str = String(s || '');
  if (!maxLen || maxLen <= 0) return str;
  return str.length <= maxLen ? str : str.slice(0, maxLen);
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': env.FRONTEND_URL || 'https://dev.jobhackai.io',
        'Access-Control-Allow-Methods': 'PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        Vary: 'Origin'
      }
    });
  }

  const id = params?.id ? String(params.id) : '';
  if (!id) {
    return jsonResponse(env, { error: 'invalid_request', reason: 'missing_id' }, 400);
  }

  if (request.method !== 'PATCH' && request.method !== 'DELETE') {
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

      const changes =
        typeof res?.meta?.changes === 'number'
          ? res.meta.changes
          : typeof res?.changes === 'number'
            ? res.changes
            : null;

      if (!res || res.success === false || changes === 0) {
        // If nothing was updated, verify the item still exists and is not deleted.
        const row = await db
          .prepare(`SELECT id FROM cover_letter_history WHERE id = ? AND user_id = ? AND is_deleted = 0`)
          .bind(id, uid)
          .first();
        if (!row) return jsonResponse(env, { error: 'not_found' }, 404);
      }

      return jsonResponse(env, { success: true });
    }

    // PATCH: rename and/or autosave edits
    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse(env, { error: 'invalid_json' }, 400);
    }

    const title = payload?.title !== undefined ? clampText(String(payload.title || '').trim(), 120) : null;
    const coverLetterText =
      payload?.coverLetterText !== undefined ? clampText(String(payload.coverLetterText || ''), 20000) : null;

    if (title === null && coverLetterText === null) {
      return jsonResponse(env, { error: 'invalid_request', reason: 'no_fields' }, 400);
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
      return jsonResponse(env, { error: 'not_found' }, 404);
    }

    return jsonResponse(env, {
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
    return jsonResponse(env, { error: 'server_error', reason: e?.message || 'unknown' }, 500);
  }
}

