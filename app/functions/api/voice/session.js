/**
 * POST /api/voice/session
 *
 * Creates (or resumes) a voice mock interview session:
 *   1. Auth + VOICE_INTERVIEW_ENABLED flag gate (404 when off: dark feature)
 *   2. Server-side entitlement gate (subscription > pack credits > free taste)
 *   3. Atomic consumption (pack decrement / free-taste flag) exactly once
 *   4. D1 voice_sessions row for lifecycle + cost tracking
 *   5. Mints an OpenAI Realtime ephemeral client secret; the browser then
 *      connects to OpenAI directly over WebRTC (no audio through Workers)
 *
 * Reconnects: body { resumeSessionId } reattaches to an existing session
 * within its time window and mints a fresh token WITHOUT consuming again,
 * so a disconnect/retry can never double-charge a pack credit.
 */

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, getDb } from '../../_lib/db.js';
import {
  getVoiceEntitlement,
  consumeVoiceSession,
  refundVoiceSession,
  createVoiceSessionRow,
  voiceFeatureEnabled
} from '../../_lib/voice-entitlements.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';

const MAX_SESSION_MINUTES = 20;
// Reconnects allowed while the session could still plausibly be live.
const RESUME_WINDOW_MS = (MAX_SESSION_MINUTES + 10) * 60 * 1000;

const DEFAULT_VOICE_MODEL = 'gpt-realtime-mini';
const DEFAULT_VOICE = 'marin';

function interviewerInstructions({ role, seniority, jd }) {
  const roleLine = seniority ? `${seniority} ${role}` : role;
  return [
    `You are a professional job interviewer running a realistic spoken mock interview for a ${roleLine} position.`,
    jd ? `The job description, for context: ${jd}` : '',
    'Rules:',
    `- Conduct a focused interview of up to ${MAX_SESSION_MINUTES} minutes. Open with a one-sentence welcome and your first question. Do not give a long preamble.`,
    '- Ask one question at a time. Mix behavioral questions with role-specific ones. Ask natural follow-ups when an answer is vague, lacks a concrete example, or skips the outcome.',
    '- Stay in character as the interviewer. Do not coach, do not give feedback mid-interview, and do not answer the questions yourself.',
    '- If the candidate asks for help or feedback, say feedback comes in the written report afterward, then continue.',
    '- Keep your own speaking turns short. The candidate should do most of the talking.',
    '- Pace for roughly 6 to 9 questions total. When time is nearly up or the question arc is complete, ask if they have anything to add, then close by thanking them and saying their feedback report is being prepared.',
    '- Speak only in English unless the candidate clearly prefers another language.'
  ].filter(Boolean).join('\n');
}

async function mintClientSecret(env, { model, instructions }) {
  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 600 },
      session: {
        type: 'realtime',
        model,
        instructions,
        audio: {
          input: {
            transcription: { model: 'whisper-1' },
            turn_detection: { type: 'semantic_vad' }
          },
          output: { voice: env.VOICE_INTERVIEW_VOICE || DEFAULT_VOICE }
        }
      }
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.value) {
    console.error('[VOICE-SESSION] Ephemeral token mint failed', { status: res.status, error: data?.error?.message });
    return null;
  }
  return { value: data.value, expiresAt: data.expires_at || null };
}

// Best-effort per-user lock to avoid two concurrent session starts doing
// duplicate work (entitlement read + token mint). This is an OPTIMIZATION, not
// the safety guard: credit integrity is enforced by the atomic conditional
// UPDATEs in consumeVoiceSession (free: `WHERE free_session_used = 0`, pack:
// `WHERE voice_sessions_remaining > 0`), which cannot double-spend even when
// this lock is absent. KV is not bound in every environment (see wrangler.toml),
// so the no-KV path must stay non-blocking; we log it rather than silently
// pretend a real lock was taken.
async function acquireKvLock(env, key, ttlSeconds = 30) {
  if (!env.JOBHACKAI_KV) {
    console.warn('[VOICE-SESSION] JOBHACKAI_KV unavailable; proceeding without advisory lock (atomic consume still guards credits)');
    return { acquired: true, token: null, noKv: true };
  }
  const existing = await env.JOBHACKAI_KV.get(key);
  if (existing) return { acquired: false, token: null };
  const token = crypto.randomUUID();
  await env.JOBHACKAI_KV.put(key, token, { expirationTtl: Math.max(60, ttlSeconds) });
  const stored = await env.JOBHACKAI_KV.get(key);
  if (stored !== token) return { acquired: false, token: null };
  return { acquired: true, token };
}

async function releaseKvLock(env, key, token) {
  if (!env.JOBHACKAI_KV || !token) return;
  const stored = await env.JOBHACKAI_KV.get(key);
  if (stored === token) await env.JOBHACKAI_KV.delete(key).catch(() => {});
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  if (request.method === 'OPTIONS') {
    return successResponse({}, 200, origin, env, requestId);
  }
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin, env, requestId);
  }

  // Dark feature: indistinguishable from a missing route when the flag is off
  if (!voiceFeatureEnabled(env)) {
    return errorResponse('Not found', 404, origin, env, requestId);
  }
  if (!env.OPENAI_API_KEY) {
    return errorResponse('Voice interviews are temporarily unavailable.', 503, origin, env, requestId);
  }

  const token = getBearer(request);
  if (!token) return errorResponse('Unauthorized', 401, origin, env, requestId);

  let uid, email;
  try {
    const verified = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    uid = verified.uid;
    email = verified.payload?.email || null;
  } catch (e) {
    return errorResponse('Unauthorized', 401, origin, env, requestId);
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const db = getDb(env);
  if (!db) return errorResponse('Storage not available. Retry later.', 503, origin, env, requestId);

  const model = env.OPENAI_MODEL_VOICE || DEFAULT_VOICE_MODEL;

  try {
    const d1User = await getOrCreateUserByAuthId(env, uid, email);
    if (!d1User?.id) return errorResponse('Failed to resolve user record', 500, origin, env, requestId);

    // ---- Resume path: reattach to an existing session, never re-consume ----
    if (body.resumeSessionId) {
      const session = await db.prepare(
        `SELECT id, user_id, role, seniority, jd_excerpt, status, started_at
         FROM voice_sessions WHERE id = ?`
      ).bind(String(body.resumeSessionId)).first();

      if (!session || session.user_id !== d1User.id) {
        return errorResponse('Session not found', 404, origin, env, requestId);
      }
      if (!['created', 'active'].includes(session.status)) {
        return errorResponse('Session already ended', 409, origin, env, requestId);
      }
      // Guard against a null/missing started_at so a bad row yields a controlled
      // 'Session expired' (via the NaN check below) instead of throwing a 500.
      const startedRaw = session.started_at ? String(session.started_at) : '';
      const startedMs = startedRaw
        ? new Date(startedRaw + (startedRaw.endsWith('Z') ? '' : 'Z')).getTime()
        : NaN;
      if (!Number.isFinite(startedMs) || Date.now() - startedMs > RESUME_WINDOW_MS) {
        await db.prepare(`UPDATE voice_sessions SET status = 'abandoned', updated_at = datetime('now') WHERE id = ?`)
          .bind(session.id).run();
        return errorResponse('Session expired', 409, origin, env, requestId);
      }

      const minted = await mintClientSecret(env, {
        model,
        instructions: interviewerInstructions({ role: session.role, seniority: session.seniority, jd: session.jd_excerpt })
      });
      if (!minted) return errorResponse('Could not start the voice session. Please try again.', 502, origin, env, requestId);

      console.log(`[VOICE-SESSION] Resumed session ${session.id} for uid=${uid} (no consumption)`);
      return successResponse({
        sessionId: session.id,
        clientSecret: minted.value,
        expiresAt: minted.expiresAt,
        model,
        resumed: true,
        maxMinutes: MAX_SESSION_MINUTES
      }, 200, origin, env, requestId);
    }

    // ---- New session path ----
    const role = String(body.role || '').trim().slice(0, 120);
    const seniority = String(body.seniority || '').trim().slice(0, 60);
    const jd = String(body.jd || '').trim().slice(0, 2000);
    if (!role) return errorResponse('Role is required', 400, origin, env, requestId);

    // Advisory per-user lock (best effort). The authoritative anti-double-spend
    // guard is the atomic conditional UPDATE in consumeVoiceSession below, which
    // holds even if this lock no-ops because KV is unbound. The lock just avoids
    // a redundant token mint when two requests race.
    const lockKey = `voiceSessionLock:${uid}`;
    const lock = await acquireKvLock(env, lockKey, 30);
    if (!lock.acquired) {
      return errorResponse('A session is already being started. Please wait.', 429, origin, env, requestId, { retryAfter: 5 });
    }

    try {
      const ent = await getVoiceEntitlement(env, uid);
      if (!ent.canStart) {
        // Infra/migration failures must not masquerade as a paywall, or
        // operators (and users) cannot tell the real blocker. Surface them as
        // a retryable 503 with no upgrade prompt.
        if (ent.reason === 'db_unavailable' || ent.reason === 'not_migrated') {
          console.error(`[VOICE-SESSION] Entitlement check unavailable for uid=${uid}: reason=${ent.reason}`);
          return errorResponse(
            'Voice interviews are temporarily unavailable. Please try again shortly.',
            503, origin, env, requestId, { reason: ent.reason }
          );
        }
        const message = ent.reason === 'limit_reached'
          ? 'You have reached this month\'s session limit. It resets at the start of next month.'
          : 'Your free voice interview is used. Upgrade to keep practicing.';
        return errorResponse(message, 403, origin, env, requestId, {
          reason: ent.reason || 'paywall',
          upgradeRequired: ent.reason !== 'limit_reached'
        });
      }

      const consumed = await consumeVoiceSession(env, uid, ent.mode);
      if (!consumed) {
        return errorResponse('Could not reserve a session. Please try again.', 409, origin, env, requestId);
      }

      const sessionId = crypto.randomUUID();
      let insertResult;
      try {
        // For subscription mode this insert enforces the fair-use cap atomically
        // (single conditional INSERT), closing the race where concurrent starts
        // each read the same sub-cap count and all proceed.
        insertResult = await createVoiceSessionRow(env, {
          sessionId, userRowId: d1User.id, role, seniority: seniority || null,
          jd: jd || null, mode: ent.mode, model
        });
      } catch (insertErr) {
        await refundVoiceSession(env, uid, ent.mode);
        throw insertErr;
      }
      if (!insertResult.inserted) {
        // Only subscription mode can be blocked here (by the cap); it consumes
        // no credit, so there is nothing to refund.
        return errorResponse(
          'You have reached this month\'s session limit. It resets at the start of next month.',
          403, origin, env, requestId, { reason: 'limit_reached' }
        );
      }

      const minted = await mintClientSecret(env, {
        model,
        instructions: interviewerInstructions({ role, seniority, jd })
      });
      if (!minted) {
        // Roll back: the user never got a session
        await refundVoiceSession(env, uid, ent.mode);
        await db.prepare(`DELETE FROM voice_sessions WHERE id = ?`).bind(sessionId).run().catch(() => {});
        return errorResponse('Could not start the voice session. Please try again.', 502, origin, env, requestId);
      }

      console.log(`[VOICE-SESSION] Created session ${sessionId} for uid=${uid} mode=${ent.mode} model=${model}`);
      return successResponse({
        sessionId,
        clientSecret: minted.value,
        expiresAt: minted.expiresAt,
        model,
        mode: ent.mode,
        sessionsRemaining: ent.mode === 'pack' ? Math.max(0, ent.sessionsRemaining - 1) : null,
        maxMinutes: MAX_SESSION_MINUTES
      }, 200, origin, env, requestId);
    } finally {
      await releaseKvLock(env, lockKey, lock.token);
    }
  } catch (err) {
    console.error('[VOICE-SESSION] Error:', err?.message || err);
    return errorResponse('Internal error', 500, origin, env, requestId);
  }
}
