/**
 * "Retry this question, free": one short voice retry of the weakest question
 * from a scored free session, without using the lifetime credit.
 *
 * This module holds the server-side allowance: which question to retry,
 * whether a session is eligible, and the atomic one-per-session claim.
 * The retry voice session itself (3-minute managed call, single-question
 * instructions, mini result) is not built yet, so the feature stays behind
 * VOICE_RETRY_ENABLED, which defaults to off. Requires migration 034.
 */

import { getDb } from './db.js';
import { interviewEvidenceTranscript, groundedCompetencies } from './voice-scorecard.js';

export const VOICE_RETRY_MINUTES = 3;
const MAX_QUESTION_CHARS = 300;

export function voiceRetryEnabled(env) {
  return env?.VOICE_RETRY_ENABLED === 'true';
}

function words(value) {
  return ' ' + String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
}

/**
 * The interviewer turn to retry, or null. Prefers the question behind a
 * competency the scorecard marked needs_practice (its quote is grounded in a
 * candidate answer). Otherwise the question that drew the shortest answer.
 * Only text the interviewer actually said is returned.
 */
export function weakestQuestion(scorecard, transcript) {
  const turns = interviewEvidenceTranscript(transcript)
    .filter(t => t && typeof t.text === 'string' && t.text.trim());
  // Each interviewer question with the candidate answer that followed it.
  const exchanges = [];
  for (const turn of turns) {
    if (turn.speaker === 'assistant') {
      if (turn.text.includes('?')) exchanges.push({ question: turn.text.trim(), answer: '' });
    } else if (exchanges.length) {
      exchanges[exchanges.length - 1].answer += ' ' + turn.text;
    }
  }
  const answered = exchanges.filter(e => e.answer.trim());
  if (!answered.length) return null;

  const weak = groundedCompetencies(scorecard?.competencies, transcript)
    .filter(c => c.status === 'needs_practice' && c.quote);
  for (const competency of weak) {
    const quote = words(competency.quote);
    const hit = answered.find(e => words(e.answer).includes(quote));
    if (hit) return hit.question.slice(0, MAX_QUESTION_CHARS);
  }
  const shortest = answered.reduce((a, b) => (b.answer.trim().length < a.answer.trim().length ? b : a));
  return shortest.question.slice(0, MAX_QUESTION_CHARS);
}

/**
 * Whether this report may offer the retry. Pure: the caller supplies the
 * session row, its parsed scorecard and transcript, and whether a retry was
 * already claimed. Returns { eligible, question } with a reason when not.
 */
export function retryEligibility({ enabled, session, scorecard, transcript, alreadyClaimed, expired }) {
  const no = reason => ({ eligible: false, reason, question: null });
  if (!enabled) return no('disabled');
  if (!session || session.entitlement_mode !== 'free') return no('not_free');
  if (session.status !== 'completed' || session.end_reason === 'ended_for_safety') return no('not_completed');
  if (expired) return no('expired');
  if (!scorecard || scorecard.tooShort || scorecard.overall == null || !Number.isFinite(Number(scorecard.overall))) return no('not_scored');
  if (alreadyClaimed) return no('already_retried');
  const question = weakestQuestion(scorecard, transcript);
  if (!question) return no('no_question');
  return { eligible: true, reason: null, question };
}

/** Whether a retry was already claimed for this session. Throws when 034 is missing. */
export async function retryClaimed(env, parentSessionId) {
  const db = getDb(env);
  if (!db) throw new Error('db_unavailable');
  return !!(await db.prepare('SELECT 1 AS claimed FROM voice_question_retries WHERE parent_session_id = ?')
    .bind(parentSessionId).first());
}

/**
 * Claim the one retry for a parent session. Atomic: the primary key admits a
 * single claim, and the INSERT only selects a completed, scored, free session
 * that the caller owns. Returns true for the request that won the claim.
 */
export async function claimRetry(env, { userRowId, parentSessionId }) {
  const db = getDb(env);
  if (!db) return false;
  const res = await db.prepare(
    `INSERT INTO voice_question_retries (parent_session_id, user_id)
     SELECT s.id, s.user_id FROM voice_sessions s
     WHERE s.id = ? AND s.user_id = ? AND s.status = 'completed' AND s.entitlement_mode = 'free'
       AND COALESCE(s.end_reason, '') <> 'ended_for_safety' AND s.scorecard_json IS NOT NULL
       AND COALESCE(json_extract(s.scorecard_json, '$.tooShort'), 0) = 0
     ON CONFLICT(parent_session_id) DO NOTHING`
  ).bind(parentSessionId, userRowId).run();
  return (res?.meta?.changes ?? 0) === 1;
}
