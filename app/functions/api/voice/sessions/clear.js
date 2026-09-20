/**
 * POST /api/voice/sessions/clear
 *
 * Owner-only clear-all for the voice history rail (the voice counterpart of
 * the typed rail's clear-history flow). Deletes every voice_sessions row
 * belonging to the authenticated user; entitlement state (credits, free-taste
 * flag) is untouched — clearing history never refunds or re-grants sessions.
 */

import { getBearer, verifyFirebaseIdToken } from '../../../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, getDb } from '../../../_lib/db.js';
import { voiceFeatureEnabled } from '../../../_lib/voice-entitlements.js';
import { clearVoiceSessions } from '../../../_lib/voice-history.js';
import { errorResponse, successResponse, generateRequestId } from '../../../_lib/error-handler.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  if (request.method === 'OPTIONS') return successResponse({}, 200, origin, env, requestId);
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, origin, env, requestId);
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
    if (!d1User?.id) return successResponse({ success: true, deleted: 0 }, 200, origin, env, requestId);

    const deleted = await clearVoiceSessions(env, d1User.id);
    console.log(`[VOICE-SESSIONS-CLEAR] uid=${uid} deleted=${deleted}`);
    return successResponse({ success: true, deleted }, 200, origin, env, requestId);
  } catch (err) {
    console.error('[VOICE-SESSIONS-CLEAR] Error:', err?.message || err);
    return errorResponse('Internal error', 500, origin, env, requestId);
  }
}
