import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getDb, getOrCreateUserByAuthId } from '../_lib/db.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405, origin, env);
  }

  try {
    const token = getBearer(request);
    if (!token) {
      return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    }

    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    if (!uid) {
      return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    }

    const body = await request.json();
    const termsVersion = body.termsVersion || '1.0';
    const privacyVersion = body.privacyVersion || '2025-12-16';

    const db = getDb(env);
    if (!db) {
      console.warn('[ACCEPT-TERMS] D1 binding not available');
      return json({ ok: true, message: 'Terms acceptance acknowledged (DB unavailable)' }, 200, origin, env);
    }

    // Ensure user row exists before UPDATE (D1 user records are created on-demand)
    const d1User = await getOrCreateUserByAuthId(env, uid, null);
    if (!d1User) {
      console.warn('[ACCEPT-TERMS] Could not get or create user record');
      return json({ ok: true, message: 'Terms acceptance acknowledged (DB unavailable)' }, 200, origin, env);
    }

    const now = new Date().toISOString();
    try {
      // Only set acceptance timestamps if not already recorded (preserve original acceptance date).
      // Always update the version columns so re-acceptance of newer terms is tracked.
      const result = await db.prepare(
        `UPDATE users
         SET terms_accepted_at = COALESCE(terms_accepted_at, ?),
             terms_version = ?,
             privacy_accepted_at = COALESCE(privacy_accepted_at, ?),
             privacy_version = ?,
             updated_at = datetime('now')
         WHERE auth_id = ?`
      ).bind(now, termsVersion, now, privacyVersion, uid).run();

      // Check if UPDATE actually affected a row
      if (result.meta.changes === 0) {
        console.warn('[ACCEPT-TERMS] UPDATE affected 0 rows for uid:', uid);
        return json({ ok: false, error: 'Failed to record terms acceptance' }, 500, origin, env);
      }

      // Read back the actual stored timestamp (may be the original, not `now`)
      const row = await db.prepare(
        `SELECT terms_accepted_at FROM users WHERE auth_id = ?`
      ).bind(uid).first();

      const acceptedAt = row?.terms_accepted_at || now;
      console.log('[ACCEPT-TERMS] Recorded acceptance:', { uid, termsVersion, privacyVersion, acceptedAt });
      return json({ ok: true, message: 'Terms acceptance recorded', acceptedAt }, 200, origin, env);
    } catch (dbErr) {
      const msg = String(dbErr?.message || '').toLowerCase();
      if (msg.includes('no such column')) {
        console.warn('[ACCEPT-TERMS] Terms columns not found. Migration 019 may need to be run.');
        return json({ ok: true, message: 'Terms acceptance acknowledged (DB schema not ready)' }, 200, origin, env);
      } else {
        console.error('[ACCEPT-TERMS] Database error:', dbErr);
        throw dbErr;
      }
    }
  } catch (error) {
    console.error('[ACCEPT-TERMS] Error:', error);
    return json({ ok: false, error: 'Internal server error' }, 500, origin, env);
  }
}

function json(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin, env)
    }
  });
}

function corsHeaders(origin, env) {
  const allowedOrigins = [
    'https://app.jobhackai.io',
    'https://qa.jobhackai.io',
    'https://dev.jobhackai.io',
    'http://localhost:3003',
    'http://localhost:8788'
  ];
  const allowed = allowedOrigins.includes(origin) ? origin : (env?.FRONTEND_URL || allowedOrigins[0]);
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}
