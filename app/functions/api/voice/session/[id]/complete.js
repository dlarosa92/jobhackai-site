/**
 * POST /api/voice/session/:id/complete
 *
 * Ends a voice session: persists the transcript, duration, and token usage
 * (client-reported from the Realtime data channel), computes the per-session
 * model cost for unit economics tracking, and kicks off scorecard generation
 * in the background. Idempotent: completing twice keeps the first transcript.
 */

import { getBearer, verifyFirebaseIdToken } from '../../../../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, getDb } from '../../../../_lib/db.js';
import { voiceFeatureEnabled } from '../../../../_lib/voice-entitlements.js';
import { generateAndStoreScorecard } from '../../../../_lib/voice-scorecard.js';
import { errorResponse, successResponse, generateRequestId } from '../../../../_lib/error-handler.js';

const MAX_TRANSCRIPT_BYTES = 300 * 1024;

// Default $/1M token rates for cost logging (gpt-realtime-mini audio rates).
// Override per environment when the model or OpenAI pricing changes:
// VOICE_COST_IN_PER_M / VOICE_COST_OUT_PER_M.
const DEFAULT_COST_IN_PER_M = 10;
const DEFAULT_COST_OUT_PER_M = 20;

export async function onRequest(context) {
  const { request, env, params } = context;
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

  let body = {};
  try { body = await request.json(); } catch (_) {
    return errorResponse('Invalid JSON', 400, origin, env, requestId);
  }

  try {
    const d1User = await getOrCreateUserByAuthId(env, uid, null, { updateActivity: false });
    const sessionId = String(params.id || '');
    const session = await db.prepare(
      `SELECT id, user_id, status, transcript_json FROM voice_sessions WHERE id = ?`
    ).bind(sessionId).first();

    if (!session || !d1User || session.user_id !== d1User.id) {
      return errorResponse('Session not found', 404, origin, env, requestId);
    }
    if (session.status === 'completed' && session.transcript_json) {
      // Idempotent: keep the original completion, still ensure a scorecard exists
      context.waitUntil(generateAndStoreScorecard(env, sessionId));
      return successResponse({ sessionId, status: 'completed', alreadyCompleted: true }, 200, origin, env, requestId);
    }

    // Transcript: [{ speaker: 'user'|'assistant', text: '...' }, ...]
    let transcript = Array.isArray(body.transcript) ? body.transcript : [];
    transcript = transcript
      .filter((t) => t && typeof t.text === 'string' && (t.speaker === 'user' || t.speaker === 'assistant'))
      .map((t) => ({ speaker: t.speaker, text: t.text.slice(0, 4000) }))
      // Keep the most recent turns, matching the byte-overflow branch below:
      // in a long interview the closing questions and stated outcomes carry
      // the most scoring signal, so the tail must survive, not the opening.
      .slice(-400);
    let transcriptJson = JSON.stringify(transcript);
    if (transcriptJson.length > MAX_TRANSCRIPT_BYTES) {
      transcript = transcript.slice(-200);
      transcriptJson = JSON.stringify(transcript);
    }

    const durationSeconds = Number.isFinite(Number(body.durationSeconds))
      ? Math.max(0, Math.min(3600, Math.round(Number(body.durationSeconds))))
      : null;
    const inputTokens = Number.isFinite(Number(body.inputTokens)) ? Math.max(0, Math.round(Number(body.inputTokens))) : null;
    const outputTokens = Number.isFinite(Number(body.outputTokens)) ? Math.max(0, Math.round(Number(body.outputTokens))) : null;

    const inRate = Number(env.VOICE_COST_IN_PER_M) || DEFAULT_COST_IN_PER_M;
    const outRate = Number(env.VOICE_COST_OUT_PER_M) || DEFAULT_COST_OUT_PER_M;
    const costUsd = (inputTokens != null && outputTokens != null)
      ? Number(((inputTokens * inRate + outputTokens * outRate) / 1e6).toFixed(4))
      : null;

    await db.prepare(
      `UPDATE voice_sessions SET
         status = 'completed',
         ended_at = datetime('now'),
         duration_seconds = ?,
         transcript_json = ?,
         input_tokens = ?,
         output_tokens = ?,
         cost_usd = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).bind(durationSeconds, transcriptJson, inputTokens, outputTokens, costUsd, sessionId).run();

    // Unit economics log line (client-reported usage; see runbook brief §2)
    console.log(`[VOICE-COST] session=${sessionId} uid=${uid} duration=${durationSeconds}s in=${inputTokens} out=${outputTokens} cost_usd=${costUsd}`);

    // Scorecard generation off the request path; client polls the session GET
    context.waitUntil(generateAndStoreScorecard(env, sessionId));

    return successResponse({ sessionId, status: 'completed', costUsd }, 200, origin, env, requestId);
  } catch (err) {
    console.error('[VOICE-COMPLETE] Error:', err?.message || err);
    return errorResponse('Internal error', 500, origin, env, requestId);
  }
}
