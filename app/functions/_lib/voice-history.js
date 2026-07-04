/**
 * Voice mock interview session history.
 *
 * Query/shaping logic for the history rail endpoints, kept out of the route
 * handlers so it can be unit-tested against a fake D1 (same pattern as
 * voice-entitlements.js). Retention mirrors the typed mock interview rule
 * (90 days, enforced by workers/retention-cleaner) with one voice-only
 * carve-out: a user with no active voice plan keeps their most recent
 * session row visible in history past 90 days, with the report locked
 * (reportAvailable: false). Paid/entitled users' aged sessions disappear
 * from the list exactly like typed sessions do.
 */

import { getDb } from './db.js';

export const HISTORY_LIMIT = 10;
export const HISTORY_RETENTION_DAYS = 90;

/**
 * Parse a D1 datetime ("YYYY-MM-DD HH:MM:SS", UTC) or ISO string to epoch ms.
 */
export function parseDbTime(value) {
  if (!value) return NaN;
  let s = String(value);
  if (!s.includes('T')) s = s.replace(' ', 'T');
  if (!s.endsWith('Z') && !/[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  return new Date(s).getTime();
}

/**
 * Whether the session is past the 90-day retention window.
 */
export function isSessionExpired(startedAt, nowMs = Date.now()) {
  const started = parseDbTime(startedAt);
  if (!Number.isFinite(started)) return false;
  return nowMs - started > HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * An "active voice plan" for retention purposes: unlimited subscription or
 * usable pack credits (the handoff's "unlimited false and no pack credits"
 * rule, inverted). hasEverPaid alone does NOT keep aged rows listed.
 */
export function hasActiveVoicePlan(ent) {
  return !!(ent && (ent.unlimited || ent.sessionsRemaining > 0));
}

/**
 * Full-report access for a session row, mirroring GET /api/voice/session/:id:
 * paid sessions, currently entitled users, or anyone who has ever paid.
 */
export function sessionFullAccess(row, ent) {
  return row.entitlement_mode !== 'free'
    || !!ent?.unlimited
    || (ent?.sessionsRemaining || 0) > 0
    || !!ent?.hasEverPaid;
}

/**
 * List the user's completed voice sessions for the history rail, newest
 * first, at most HISTORY_LIMIT. Sessions older than the retention window are
 * excluded, except the carve-out: when the user has no active voice plan,
 * their most recent session row stays listed (metadata only) with
 * reportAvailable: false.
 *
 * @returns {Promise<Array<{
 *   sessionId: string, role: string|null, seniority: string|null,
 *   createdAt: string, durationSeconds: number|null,
 *   status: 'scoring'|'ready', overall: number|null,
 *   fullAccess: boolean, reportAvailable: boolean
 * }>>}
 */
export async function listVoiceSessions(env, userRowId, ent, nowMs = Date.now()) {
  const db = getDb(env);
  if (!db) return [];

  // Newest 25 completed rows are always enough: expired rows sort strictly
  // after live ones, and the carve-out row is by definition the newest row.
  const rows = await db.prepare(
    `SELECT id, role, seniority, status, entitlement_mode, started_at, duration_seconds, scorecard_json
     FROM voice_sessions
     WHERE user_id = ? AND status = 'completed'
     ORDER BY started_at DESC LIMIT 25`
  ).bind(userRowId).all();

  const results = rows?.results || [];
  const activePlan = hasActiveVoicePlan(ent);
  const sessions = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const expired = isSessionExpired(r.started_at, nowMs);
    // Retention: aged rows drop out of the list, except the most recent row
    // of a user with no active voice plan (their single free-taste session).
    if (expired && (activePlan || i !== 0)) continue;

    const fullAccess = sessionFullAccess(r, ent);
    let scorecard = null;
    try { scorecard = r.scorecard_json ? JSON.parse(r.scorecard_json) : null; } catch (_) {}

    sessions.push({
      sessionId: r.id,
      role: r.role,
      seniority: r.seniority,
      createdAt: r.started_at,
      durationSeconds: r.duration_seconds,
      status: scorecard ? 'ready' : 'scoring',
      overall: fullAccess && scorecard ? (scorecard.overall ?? null) : null,
      fullAccess,
      reportAvailable: !expired
    });
    if (sessions.length >= HISTORY_LIMIT) break;
  }

  return sessions;
}

/**
 * Owner-only delete of one session (mirrors the typed delete: ownership is
 * enforced in the SQL, 0 changes means not found / not yours).
 *
 * @returns {Promise<boolean>} true when a row was deleted
 */
export async function deleteVoiceSession(env, userRowId, sessionId) {
  const db = getDb(env);
  if (!db) return false;
  const res = await db.prepare(
    `DELETE FROM voice_sessions WHERE id = ? AND user_id = ?`
  ).bind(String(sessionId), userRowId).run();
  const changes = typeof res?.meta?.changes === 'number' ? res.meta.changes : (res?.changes || 0);
  return changes > 0;
}

/**
 * Owner-only clear of the user's voice history. In-flight sessions
 * (created/active) are never touched: the rail is visible during a live
 * interview, and clearing history must not destroy the session row the
 * upcoming /complete call needs — that would lose the just-consumed
 * interview. Abandoned rows are cleared too; they are invisible in the
 * list and can no longer be completed.
 *
 * @returns {Promise<number>} number of rows deleted
 */
export async function clearVoiceSessions(env, userRowId) {
  const db = getDb(env);
  if (!db) return 0;
  const res = await db.prepare(
    `DELETE FROM voice_sessions WHERE user_id = ? AND status NOT IN ('created', 'active')`
  ).bind(userRowId).run();
  return typeof res?.meta?.changes === 'number' ? res.meta.changes : (res?.changes || 0);
}
