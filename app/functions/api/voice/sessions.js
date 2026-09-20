/**
 * GET /api/voice/sessions
 *
 * Lists the authenticated user's completed voice sessions for the history
 * rail, newest first, max 10. Overall scores are included only for sessions
 * the user has full access to (paid sessions, or any session once the user
 * has ever paid); free/partial rows return overall: null.
 *
 * Retention mirrors the typed mock interview (90 days, deleted by
 * workers/retention-cleaner) with the free-taste carve-out: a user with no
 * active voice plan keeps their most recent session row listed past 90 days
 * with reportAvailable: false. See _lib/voice-history.js.
 */

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, getDb } from '../../_lib/db.js';
import { getVoiceEntitlement, voiceFeatureEnabled } from '../../_lib/voice-entitlements.js';
import { listVoiceSessions } from '../../_lib/voice-history.js';
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

    const ent = await getVoiceEntitlement(env, uid);
    const sessions = await listVoiceSessions(env, d1User.id, ent);

    return successResponse({ sessions }, 200, origin, env, requestId);
  } catch (err) {
    console.error('[VOICE-SESSIONS] Error:', err?.message || err);
    return errorResponse('Internal error', 500, origin, env, requestId);
  }
}
