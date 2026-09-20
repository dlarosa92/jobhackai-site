/**
 * GET /api/voice/session/:id
 *
 * Returns the session with its scorecard, gated by entitlement:
 * - Paid sessions (pack/subscription) and currently entitled users get the
 *   full report and transcript.
 * - Free-taste users get the partial scorecard only: top strength + one
 *   improvement area. The full report and transcript stay behind the paywall
 *   server-side, so no client-state tampering can reveal them.
 * - Sessions past the 90-day retention window return a minimal expired
 *   payload (expired: true); the client renders the locked view.
 *
 * DELETE /api/voice/session/:id
 *
 * Owner-only delete for the history rail (mirrors the typed mock interview
 * session delete: ownership enforced, 404 when the row isn't the caller's).
 */

import { getBearer, verifyFirebaseIdToken } from '../../../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, getDb } from '../../../_lib/db.js';
import { getVoiceEntitlement, voiceFeatureEnabled } from '../../../_lib/voice-entitlements.js';
import { partialScorecard } from '../../../_lib/voice-scorecard.js';
import { isSessionExpired, deleteVoiceSession } from '../../../_lib/voice-history.js';
import { errorResponse, successResponse, generateRequestId } from '../../../_lib/error-handler.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  if (request.method === 'OPTIONS') return successResponse({}, 200, origin, env, requestId);
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    return errorResponse('Method not allowed', 405, origin, env, requestId);
  }
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
    const session = await db.prepare(
      `SELECT id, user_id, role, seniority, status, entitlement_mode, started_at, ended_at,
              duration_seconds, transcript_json, scorecard_json, end_reason
       FROM voice_sessions WHERE id = ?`
    ).bind(String(params.id || '')).first();

    if (!session || !d1User || session.user_id !== d1User.id) {
      return errorResponse('Session not found', 404, origin, env, requestId);
    }

    if (request.method === 'DELETE') {
      const deleted = await deleteVoiceSession(env, d1User.id, session.id);
      if (!deleted) return errorResponse('Session not found', 404, origin, env, requestId);
      console.log(`[VOICE-SESSION-DELETE] Deleted session ${session.id} for uid=${uid}`);
      return successResponse({ success: true }, 200, origin, env, requestId);
    }

    let scorecard = null;
    try { scorecard = session.scorecard_json ? JSON.parse(session.scorecard_json) : null; } catch (_) {}

    // Past the 90-day retention window the report is locked for everyone:
    // the retention-cleaner will remove the payload (or, for the free-taste
    // carve-out row, strip it while keeping the metadata). Serve a minimal
    // expired payload either way; the client renders the locked view.
    if (isSessionExpired(session.started_at)) {
      return successResponse({
        sessionId: session.id,
        role: session.role,
        seniority: session.seniority,
        status: session.status,
        startedAt: session.started_at,
        createdAt: session.started_at,
        endedAt: session.ended_at,
        durationSeconds: session.duration_seconds,
        scorecardReady: true,
        fullAccess: false,
        expired: true,
        endReason: session.end_reason || null,
        scorecard: {
          topStrength: scorecard?.topStrength ?? null,
          topImprovement: scorecard?.topImprovement ?? null
        },
        transcript: null
      }, 200, origin, env, requestId);
    }

    // Full access: the session itself was paid for, or the user is currently
    // entitled (active subscription, grandfathered legacy plan, or pack
    // credits remaining), or the user has ever paid. Upgrading retroactively
    // unlocks the free-taste session, and that unlock persists after a pack
    // lapses or a subscription is cancelled (hasEverPaid).
    const ent = await getVoiceEntitlement(env, uid);
    const fullAccess = session.entitlement_mode !== 'free'
      || ent.unlimited
      || ent.sessionsRemaining > 0
      || ent.hasEverPaid;

    let transcript = null;
    if (fullAccess && session.transcript_json) {
      try { transcript = JSON.parse(session.transcript_json); } catch (_) {}
    }

    return successResponse({
      sessionId: session.id,
      role: session.role,
      seniority: session.seniority,
      status: session.status,
      startedAt: session.started_at,
      createdAt: session.started_at,
      endedAt: session.ended_at,
      durationSeconds: session.duration_seconds,
      scorecardReady: !!scorecard,
      endReason: session.end_reason || null,
      fullAccess,
      scorecard: fullAccess ? scorecard : partialScorecard(scorecard),
      transcript
    }, 200, origin, env, requestId);
  } catch (err) {
    console.error('[VOICE-SESSION-GET] Error:', err?.message || err);
    return errorResponse('Internal error', 500, origin, env, requestId);
  }
}
