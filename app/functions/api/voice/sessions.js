/**
 * GET /api/voice/sessions
 *
 * Lists the user's voice sessions for history and progress tracking.
 * Overall scores are included only for sessions the user has full access to
 * (paid sessions, or any session once the user is currently entitled).
 */

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, getDb } from '../../_lib/db.js';
import { getVoiceEntitlement, voiceFeatureEnabled } from '../../_lib/voice-entitlements.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  if (request.method === 'OPTIONS') return successResponse({}, 200, origin, env, requestId);
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405, origin, env, requestId);
  if (!voiceFeatureEnabled(env)) return errorResponse('Not found', 404, origin, env, requestId);

  const token = getBearer(request);
  if (!token) return errorResponse('Unauthorized', 401, origin, env, requestId);

  let uid;
  try {
    ({ uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID));
  } catch (_) {
    return errorResponse('Unauthorized', 401, origin, env, requestId);
  }

  const db = getDb(env);
  if (!db) return errorResponse('Storage not available. Retry later.', 503, origin, env, requestId);

  try {
    const d1User = await getOrCreateUserByAuthId(env, uid, null, { updateActivity: false });
    if (!d1User?.id) return successResponse({ sessions: [] }, 200, origin, env, requestId);

    const rows = await db.prepare(
      `SELECT id, role, seniority, status, entitlement_mode, started_at, duration_seconds, scorecard_json
       FROM voice_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 25`
    ).bind(d1User.id).all();

    const ent = await getVoiceEntitlement(env, uid);

    const sessions = (rows?.results || []).map((r) => {
      const fullAccess = r.entitlement_mode !== 'free' || ent.unlimited || ent.sessionsRemaining > 0;
      let overall = null;
      if (fullAccess && r.scorecard_json) {
        try { overall = JSON.parse(r.scorecard_json).overall ?? null; } catch (_) {}
      }
      return {
        sessionId: r.id,
        role: r.role,
        seniority: r.seniority,
        status: r.status,
        startedAt: r.started_at,
        durationSeconds: r.duration_seconds,
        overall,
        fullAccess
      };
    });

    return successResponse({ sessions }, 200, origin, env, requestId);
  } catch (err) {
    console.error('[VOICE-SESSIONS] Error:', err?.message || err);
    return errorResponse('Internal error', 500, origin, env, requestId);
  }
}
