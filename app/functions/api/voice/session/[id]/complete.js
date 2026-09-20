/**
 * POST /api/voice/session/:id/complete
 *
 * Ends a voice session: persists the transcript, duration, and token usage
 * (client-reported from the Realtime data channel), retains bounded evidence
 * for cost reconciliation, and kicks off scorecard generation
 * in the background. Idempotent: completing twice keeps the first transcript.
 */

import { getBearer, verifyFirebaseIdToken } from '../../../../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, getDb } from '../../../../_lib/db.js';
import { voiceFeatureEnabled } from '../../../../_lib/voice-entitlements.js';
import { normalizeEndReason, shouldGenerateScorecard } from '../../../../_lib/voice-interviewer.js';
import { generateAndStoreScorecard } from '../../../../_lib/voice-scorecard.js';
import { errorResponse, successResponse, generateRequestId } from '../../../../_lib/error-handler.js';

import { normalizeVoiceUsage, responseTokenTotals } from '../../../../_lib/voice-usage.js';

const MAX_TRANSCRIPT_BYTES = 300 * 1024;

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
      `SELECT id, user_id, status, transcript_json, end_reason FROM voice_sessions WHERE id = ?`
    ).bind(sessionId).first();

    if (!session || !d1User || session.user_id !== d1User.id) {
      return errorResponse('Session not found', 404, origin, env, requestId);
    }
    if (session.status === 'completed') {
      // Idempotent: keep the original completion, still ensure a scorecard
      // exists — except for a safety-ended session, which is never scored.
      if (shouldGenerateScorecard(session.end_reason)) {
        context.waitUntil(generateAndStoreScorecard(env, sessionId));
      }
      return successResponse({ sessionId, status: 'completed', alreadyCompleted: true, endReason: session.end_reason || null }, 200, origin, env, requestId);
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
    const usageEvidence = normalizeVoiceUsage(body.usageEvidence);
    const { input: inputTokens, output: outputTokens } = responseTokenTotals(usageEvidence);
    // A client report is incomplete evidence, not provider billing. Do not
    // apply audio rates to text/cache tokens or invent zero for absent usage.
    const costUsd = null;

    // Why the session ended, clamped to the allowlist. A conduct termination
    // is otherwise indistinguishable from a normal one, which makes it
    // impossible to audit or count.
    const endReason = normalizeEndReason(body.reason);

    const completion = await db.prepare(
      `UPDATE voice_sessions SET
         status = 'completed',
         ended_at = datetime('now'),
         end_reason = ?,
         duration_seconds = ?,
         transcript_json = ?,
         input_tokens = ?,
         output_tokens = ?,
         cost_usd = ?,
         usage_details_json = ?,
         updated_at = datetime('now')
       WHERE id = ? AND status != 'completed'`
    ).bind(endReason, durationSeconds, transcriptJson, inputTokens, outputTokens, costUsd, JSON.stringify({ version: 1, realtime: usageEvidence }), sessionId).run();

    if ((completion?.meta?.changes ?? 0) !== 1) {
      // Another completion won after our SELECT. Never replace its transcript
      // or make a scoring decision from the losing request's end reason.
      const saved = await db.prepare('SELECT status, end_reason FROM voice_sessions WHERE id = ?')
        .bind(sessionId).first();
      if (!saved || saved.status !== 'completed') {
        return errorResponse('Session not found', 404, origin, env, requestId);
      }
      if (shouldGenerateScorecard(saved.end_reason)) {
        context.waitUntil(generateAndStoreScorecard(env, sessionId));
      }
      return successResponse({ sessionId, status: 'completed', alreadyCompleted: true, endReason: saved.end_reason || null }, 200, origin, env, requestId);
    }

    // Observed client usage only; provider reconciliation remains required.
    console.log(`[VOICE-COST] session=${sessionId} uid=${uid} duration=${durationSeconds}s in=${inputTokens} out=${outputTokens} cost_usd=${costUsd} end=${endReason || 'unknown'}`);
    if (endReason === 'ended_by_interviewer' || endReason === 'ended_by_interviewer_unwarned') {
      console.warn(`[VOICE-CONDUCT] session=${sessionId} uid=${uid} end=${endReason}`);
    }

    // Scorecard generation off the request path; client polls the session GET.
    // A safety-ended session is never scored (see shouldGenerateScorecard).
    if (shouldGenerateScorecard(endReason)) {
      context.waitUntil(generateAndStoreScorecard(env, sessionId));
    } else {
      console.log(`[VOICE-SAFETY] session=${sessionId} scorecard suppressed (ended_for_safety)`);
    }

    return successResponse({ sessionId, status: 'completed', costUsd, endReason }, 200, origin, env, requestId);
  } catch (err) {
    console.error('[VOICE-COMPLETE] Error:', err?.message || err);
    return errorResponse('Internal error', 500, origin, env, requestId);
  }
}
