/**
 * Voice mock interview entitlements.
 *
 * Single server-side gate for "can this user start a voice session" plus the
 * atomic consumption operations. D1 is the source of truth; entitlement fields
 * on users (voice_sessions_remaining, free_session_used, pack_expires_at) are
 * written only by Stripe webhooks and the functions in this module. Clients
 * have no write path to any of these fields.
 *
 * Entitlement order of precedence:
 *   1. Active subscription (weekly/monthly, or grandfathered legacy plan)
 *      -> unlimited sessions, silently bounded by VOICE_FAIR_USE_CAP per month
 *   2. Interview Pack credits (voice_sessions_remaining > 0, not expired)
 *   3. Free taste: exactly 1 lifetime session per account
 */

import { getDb } from './db.js';

export const PACK_SESSION_COUNT = 5;
export const PACK_EXPIRY_DAYS = 90;
export const DEFAULT_FAIR_USE_CAP = 60; // sessions per calendar month

const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due']);

// Plans whose active subscription grants unlimited voice sessions.
// Grandfathering rule: any user with an active Stripe subscription whose price
// is not one of the three new prices keeps a legacy plan value here and is
// treated exactly like plan=monthly (unlimited sessions).
const UNLIMITED_VOICE_PLANS = new Set(['weekly', 'monthly', 'trial', 'essential', 'pro', 'premium']);

// Renewal webhooks can lag the period boundary; give 3 days of grace before
// treating a stale current_period_end as expired.
const PERIOD_END_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export function voiceFeatureEnabled(env) {
  return String(env?.VOICE_INTERVIEW_ENABLED || '').toLowerCase() === 'true';
}

export function fairUseCap(env) {
  const n = parseInt(env?.VOICE_FAIR_USE_CAP, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FAIR_USE_CAP;
}

function isMissingColumnError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('no such column') || msg.includes('no such table') || msg.includes('unknown column');
}

/**
 * Count voice sessions started by this user in the current calendar month.
 * Abandoned sessions count too: they consumed a session slot at create time.
 */
async function countSessionsThisMonth(db, userRowId) {
  // Use strftime so the comparison matches the stored started_at format
  // (datetime('now') => 'YYYY-MM-DD HH:MM:SS'); comparing against an ISO 'T...Z'
  // boundary string was unreliable (space vs 'T') and dropped day-1 sessions.
  // SQLite 'now' is UTC, so this is a UTC calendar-month count.
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM voice_sessions
     WHERE user_id = ? AND strftime('%Y-%m', started_at) = strftime('%Y-%m', 'now')`
  ).bind(userRowId).first();
  return Number(row?.n || 0);
}

/**
 * Evaluate whether a user can start a voice session. Read-only.
 *
 * @returns {Promise<{
 *   canStart: boolean,
 *   mode: 'subscription'|'pack'|'free'|null,
 *   reason: string|null,           // when canStart=false: 'paywall' | 'limit_reached' | 'db_unavailable' | 'not_migrated'
 *   unlimited: boolean,
 *   freeSessionUsed: boolean,
 *   sessionsRemaining: number,     // pack credits currently usable
 *   plan: string,
 *   hasEverPaid: boolean           // ever purchased (pack or subscription)
 * }>}
 */
export async function getVoiceEntitlement(env, uid) {
  const db = getDb(env);
  const base = {
    canStart: false, mode: null, reason: 'db_unavailable',
    unlimited: false, freeSessionUsed: false, sessionsRemaining: 0, plan: 'free',
    hasEverPaid: false
  };
  if (!db) return base;

  let row;
  try {
    row = await db.prepare(
      `SELECT id, plan, subscription_status, current_period_end,
              voice_sessions_remaining, free_session_used, pack_expires_at, has_ever_paid
       FROM users WHERE auth_id = ?`
    ).bind(uid).first();
  } catch (err) {
    if (isMissingColumnError(err)) {
      console.warn('[VOICE-ENTITLEMENTS] Migration 020 not applied yet:', err?.message);
      return { ...base, reason: 'not_migrated' };
    }
    throw err;
  }

  // Brand-new account with no row yet: they still have their free taste.
  if (!row) {
    return { ...base, canStart: true, mode: 'free', reason: null };
  }

  const plan = row.plan || 'free';
  const now = Date.now();
  // Whether the user has ever paid (pack or subscription). Used by the read
  // endpoints to keep a free-taste session's full report unlocked permanently
  // once the user has paid, even after a pack lapses or a sub is cancelled.
  const hasEverPaid = !!row.has_ever_paid;

  // 1. Active subscription (new voice plans or grandfathered legacy plans).
  // Require POSITIVE evidence of a live subscription before granting unlimited:
  // an active subscription_status. A bare plan label with no Stripe state (null
  // status, e.g. a stale or legacy row) must NOT get unlimited voice; it falls
  // through to pack credits or the free taste below. current_period_end stays
  // lenient (null allowed) because an active status is sufficient evidence, but
  // a non-null period that has passed (beyond grace) revokes access.
  // NOTE: a manually granted plan (e.g. the white-glove customer) must also set
  // subscription_status to an active value for this to apply.
  if (UNLIMITED_VOICE_PLANS.has(plan)) {
    const statusOk = ACTIVE_SUB_STATUSES.has(row.subscription_status);
    const periodOk = !row.current_period_end ||
      (new Date(row.current_period_end).getTime() + PERIOD_END_GRACE_MS) > now;
    if (statusOk && periodOk) {
      let used = 0;
      try {
        used = await countSessionsThisMonth(db, row.id);
      } catch (err) {
        if (!isMissingColumnError(err)) throw err;
      }
      if (used >= fairUseCap(env)) {
        // Fair use cap, enforced silently server-side with a neutral message.
        return {
          canStart: false, mode: 'subscription', reason: 'limit_reached',
          unlimited: true, freeSessionUsed: !!row.free_session_used,
          sessionsRemaining: Number(row.voice_sessions_remaining || 0), plan, hasEverPaid
        };
      }
      return {
        canStart: true, mode: 'subscription', reason: null,
        unlimited: true, freeSessionUsed: !!row.free_session_used,
        sessionsRemaining: Number(row.voice_sessions_remaining || 0), plan, hasEverPaid
      };
    }
  }

  // 2. Interview Pack credits
  const packRemaining = Number(row.voice_sessions_remaining || 0);
  const packValid = packRemaining > 0 &&
    (!row.pack_expires_at || new Date(row.pack_expires_at).getTime() > now);
  if (packValid) {
    return {
      canStart: true, mode: 'pack', reason: null,
      unlimited: false, freeSessionUsed: !!row.free_session_used,
      sessionsRemaining: packRemaining, plan, hasEverPaid
    };
  }

  // 3. Free taste: 1 lifetime session
  if (!row.free_session_used) {
    return {
      canStart: true, mode: 'free', reason: null,
      unlimited: false, freeSessionUsed: false, sessionsRemaining: 0, plan, hasEverPaid
    };
  }

  return {
    canStart: false, mode: null, reason: 'paywall',
    unlimited: false, freeSessionUsed: true, sessionsRemaining: 0, plan, hasEverPaid
  };
}

/**
 * Atomically consume one session for the given mode. Call exactly once per
 * session create (reconnects must reattach to the session, not re-consume).
 *
 * @returns {Promise<boolean>} true when consumption succeeded
 */
export async function consumeVoiceSession(env, uid, mode) {
  const db = getDb(env);
  if (!db) return false;

  if (mode === 'subscription') {
    // Nothing to decrement; the fair-use cap is enforced at evaluation time.
    return true;
  }

  if (mode === 'pack') {
    // Conditional UPDATE is the atomic guard: 0 rows changed means another
    // request already spent the last credit.
    const res = await db.prepare(
      `UPDATE users SET voice_sessions_remaining = voice_sessions_remaining - 1,
              updated_at = datetime('now')
       WHERE auth_id = ? AND voice_sessions_remaining > 0`
    ).bind(uid).run();
    return (res?.meta?.changes ?? 0) === 1;
  }

  if (mode === 'free') {
    const res = await db.prepare(
      `UPDATE users SET free_session_used = 1, updated_at = datetime('now')
       WHERE auth_id = ? AND free_session_used = 0`
    ).bind(uid).run();
    return (res?.meta?.changes ?? 0) === 1;
  }

  return false;
}

/**
 * Refund one consumed session (used when session setup fails after
 * consumption, e.g. the voice provider rejects the token mint).
 */
export async function refundVoiceSession(env, uid, mode) {
  const db = getDb(env);
  if (!db) return false;
  try {
    if (mode === 'pack') {
      await db.prepare(
        `UPDATE users SET voice_sessions_remaining = voice_sessions_remaining + 1,
                updated_at = datetime('now') WHERE auth_id = ?`
      ).bind(uid).run();
      return true;
    }
    if (mode === 'free') {
      await db.prepare(
        `UPDATE users SET free_session_used = 0, updated_at = datetime('now') WHERE auth_id = ?`
      ).bind(uid).run();
      return true;
    }
    return true;
  } catch (err) {
    console.error('[VOICE-ENTITLEMENTS] Refund failed:', err?.message || err);
    return false;
  }
}

/**
 * Insert the voice_sessions row for a started session.
 *
 * For subscription mode the fair-use cap is enforced atomically here, not just
 * in the read-only getVoiceEntitlement check: the INSERT ... SELECT ... WHERE
 * count < cap is a single statement, so concurrent starts cannot each observe
 * the same sub-cap count and all slip through. For free/pack the credit was
 * already claimed atomically by consumeVoiceSession, so the insert is
 * unconditional.
 *
 * @returns {Promise<{inserted: boolean, reason: string|null}>}
 *   reason is 'limit_reached' when a subscription insert was blocked by the cap.
 */
export async function createVoiceSessionRow(env, { sessionId, userRowId, role, seniority, jd, mode, model }) {
  const db = getDb(env);
  if (!db) return { inserted: false, reason: 'db_unavailable' };

  if (mode === 'subscription') {
    const cap = fairUseCap(env);
    const res = await db.prepare(
      `INSERT INTO voice_sessions (id, user_id, role, seniority, jd_excerpt, status, entitlement_mode, model)
       SELECT ?, ?, ?, ?, ?, 'created', ?, ?
       WHERE (
         SELECT COUNT(*) FROM voice_sessions
         WHERE user_id = ? AND strftime('%Y-%m', started_at) = strftime('%Y-%m', 'now')
       ) < ?`
    ).bind(sessionId, userRowId, role, seniority, jd, mode, model, userRowId, cap).run();
    const inserted = (res?.meta?.changes ?? 0) === 1;
    return { inserted, reason: inserted ? null : 'limit_reached' };
  }

  await db.prepare(
    `INSERT INTO voice_sessions (id, user_id, role, seniority, jd_excerpt, status, entitlement_mode, model)
     VALUES (?, ?, ?, ?, ?, 'created', ?, ?)`
  ).bind(sessionId, userRowId, role, seniority, jd, mode, model).run();
  return { inserted: true, reason: null };
}

// Pack-grant SQL shared by grantPackCredits (standalone, legacy path) and
// buildPackGrantStatements (webhook batch) so the two can never drift.
// A new purchase refreshes the expiry for the whole balance; subscriptions
// keep their plan value (pack credits then sit unused until it lapses).
const PACK_GRANT_UPDATE_SQL = `UPDATE users SET
        voice_sessions_remaining = voice_sessions_remaining + ?,
        pack_expires_at = ?,
        has_ever_paid = 1,
        plan = CASE WHEN plan IS NULL OR plan IN ('', 'free') THEN 'pack' ELSE plan END,
        updated_at = datetime('now')
     WHERE auth_id = ?`;

export function packExpiryIso(nowMs = Date.now()) {
  return new Date(nowMs + PACK_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// stripe_event_log row types written by the webhook's pack path. The table's
// primary key is event_id (TEXT): Stripe event ids (evt_…) record WHICH
// events granted, and the Checkout Session id (cs_…) records THAT the session
// was fulfilled — one purchase can be announced by several distinct events
// (a late checkout.session.completed retried after the payment settled AND a
// checkout.session.async_payment_succeeded), so per-event idempotency alone
// would credit the same purchase twice.
export const PACK_GRANT_TYPE = 'pack_grant';
export const PACK_FULFILMENT_TYPE = 'pack_fulfilment';
export const PACK_LOG_INSERT_SQL = 'INSERT INTO stripe_event_log (event_id, type) VALUES (?, ?)';

/**
 * Batch-safe pack grant for the hardened Stripe webhook (billing hotfix):
 * returns prepared statements WITHOUT executing them, so the grant rides in
 * ONE atomic db.batch() together with the event ledger's processed-mark
 * (stripe_event_ledger, migration 022). Either everything commits or nothing
 * does: no duplicate credits, and no event consumed without its grant.
 *
 * Three idempotency records, all plain INSERTs (never OR IGNORE) so that any
 * duplicate fails the WHOLE batch atomically:
 *   1. stripe_event_log(event_id = <evt_…>, 'pack_grant') — the legacy
 *      per-event record (voice migration 020); an event the pre-ledger
 *      webhook already granted collides here.
 *   2. stripe_event_log(event_id = <cs_…>, 'pack_fulfilment') — the
 *      per-SESSION fulfilment marker; a second distinct event for the same
 *      Checkout Session collides here, whichever event arrives first and
 *      even when two arrive concurrently.
 *   3. stripe_event_ledger processed-mark (added by the caller).
 * The webhook consults stripe_event_log for both ids before staging so the
 * ordinary duplicate is a recorded no-op; the INSERTs are the race-proof
 * guard behind that read.
 *
 * @returns {Array} prepared D1 statements (empty when inputs are unusable)
 */
export function buildPackGrantStatements(db, { uid, eventId, sessionId, expiresAtIso } = {}) {
  if (!db || !uid || !eventId) return [];
  const expires = expiresAtIso || packExpiryIso();
  const statements = [db.prepare(PACK_LOG_INSERT_SQL).bind(eventId, PACK_GRANT_TYPE)];
  if (sessionId) statements.push(db.prepare(PACK_LOG_INSERT_SQL).bind(sessionId, PACK_FULFILMENT_TYPE));
  statements.push(db.prepare(PACK_GRANT_UPDATE_SQL).bind(PACK_SESSION_COUNT, expires, uid));
  return statements;
}

/**
 * Grant Interview Pack credits from a Stripe checkout.session.completed event.
 * Idempotent at the D1 level: the event id is recorded in stripe_event_log
 * first, and a replayed event becomes a no-op even if KV dedup misses.
 *
 * Standalone (non-batched) form kept for callers outside the hardened
 * webhook; the webhook itself uses buildPackGrantStatements so the grant is
 * atomic with the event ledger.
 *
 * @returns {Promise<{granted: boolean, duplicate: boolean}>}
 */
export async function grantPackCredits(env, uid, eventId) {
  const db = getDb(env);
  if (!db) return { granted: false, duplicate: false };

  const ins = await db.prepare(
    `INSERT OR IGNORE INTO stripe_event_log (event_id, type) VALUES (?, 'pack_grant')`
  ).bind(eventId).run();
  if ((ins?.meta?.changes ?? 0) === 0) {
    console.log(`[VOICE-ENTITLEMENTS] Pack grant skipped, event ${eventId} already processed`);
    return { granted: false, duplicate: true };
  }

  const expires = packExpiryIso();
  const res = await db.prepare(PACK_GRANT_UPDATE_SQL).bind(PACK_SESSION_COUNT, expires, uid).run();

  const granted = (res?.meta?.changes ?? 0) === 1;
  if (!granted) {
    // The user row was missing (or the write affected nothing), so no credits
    // were added. Release the idempotency lock we just took so a Stripe retry
    // can re-attempt the grant instead of being skipped as a duplicate. The
    // caller returns a 5xx so Stripe schedules that retry.
    await db.prepare('DELETE FROM stripe_event_log WHERE event_id = ?')
      .bind(eventId).run().catch(() => {});
  }
  return { granted, duplicate: false };
}
