// Durable webhook idempotency ledger (stripe_event_ledger, migration 022).
// This table is the AUTHORITATIVE record of which Stripe events have been
// processed; KV markers are a performance aid layered on top of it.
//
// Lifecycle:
//   claim   → INSERT status='processing', or atomically re-claim a 'failed'
//             row (Stripe retry) / a stale 'processing' row (crashed run).
//   commit  → the caller executes ONE db.batch() containing every critical
//             billing write for the event plus buildMarkProcessedStatement()
//             as its final statement, so billing state and the processed
//             mark can never diverge across a crash.
//   fail    → markEventFailed records a redacted reason label; the caller
//             returns a 5xx so Stripe retries and the event stays visible
//             to operators (SELECT ... WHERE status='failed').
//
// Fail-closed: when the table is missing or the claim query errors, the
// caller must return 503 and process nothing. There is no KV fallback —
// migration 022 is a hard pre-deploy dependency.

import { getDb } from './db.js';
import { redactId } from './stripe-environment.js';

// A 'processing' row older than this is a crashed run and may be re-claimed.
// Workers requests are hard-capped far below this, and Stripe's retry
// schedule spaces attempts minutes-to-hours apart.
export const CLAIM_TIMEOUT_MINUTES = 15;

/**
 * Atomically claim an event for processing.
 *
 * @returns {{ outcome: 'claimed' | 'already_processed' | 'in_flight' | 'unavailable' }}
 *   claimed           — this invocation owns the event; proceed.
 *   already_processed — all critical writes previously committed; return 200.
 *   in_flight         — another instance holds a fresh claim; return 503.
 *   unavailable       — ledger missing/unreachable; return 503, write nothing.
 */
export async function claimEvent(env, event) {
  const db = getDb(env);
  if (!db) {
    console.error('[EVENT-LEDGER] no D1 binding; failing closed');
    return { outcome: 'unavailable' };
  }
  try {
    const claimed = await db.prepare(
      `INSERT INTO stripe_event_ledger (event_id, event_type, livemode, status, claimed_at)
       VALUES (?1, ?2, ?3, 'processing', datetime('now'))
       ON CONFLICT(event_id) DO UPDATE SET
         status = 'processing',
         attempt_count = attempt_count + 1,
         claimed_at = datetime('now'),
         last_error = NULL
       WHERE stripe_event_ledger.status = 'failed'
          OR (stripe_event_ledger.status = 'processing'
              AND stripe_event_ledger.claimed_at <= datetime('now', '-${CLAIM_TIMEOUT_MINUTES} minutes'))
       RETURNING status`
    ).bind(event.id, event.type || 'unknown', event.livemode ? 1 : 0).first();

    if (claimed) return { outcome: 'claimed' };

    // Conflict clause declined the claim: the row exists and is either
    // processed or freshly processing.
    const row = await db.prepare(
      'SELECT status FROM stripe_event_ledger WHERE event_id = ?'
    ).bind(event.id).first();
    if (row?.status === 'processed') return { outcome: 'already_processed' };
    if (row?.status) return { outcome: 'in_flight' };

    console.error(`[EVENT-LEDGER] claim returned no row and none exists for ${redactId(event.id)}; failing closed`);
    return { outcome: 'unavailable' };
  } catch (err) {
    console.error(`[EVENT-LEDGER] claim failed for ${redactId(event.id)} (${err?.message || err}); failing closed`);
    return { outcome: 'unavailable' };
  }
}

/**
 * The processed-mark, as a prepared statement for the caller's db.batch().
 * MUST ride in the same batch as the event's critical writes.
 *
 * requireUserRows: auth_ids whose users row MUST exist when the batch
 * commits. Every staged users-row write is `UPDATE users … WHERE auth_id = ?`
 * (auth_id is UNIQUE NOT NULL), so "row exists at commit time" is exactly
 * "that write affected one row". When any required row is missing, the CASE
 * yields NULL for the NOT NULL status column, the UPDATE is refused, and the
 * WHOLE batch rolls back — credits, plan writes and idempotency records alike
 * — so the event stays retryable instead of being marked processed with no
 * recipient (a row deleted between ensureUserRow and the commit).
 * Tombstoned accounts never reach this guard: ensureUserRow turns them into
 * a deliberate no-op (nothing staged, nothing required) before staging.
 */
export function buildMarkProcessedStatement(db, eventId, { requireUserRows = [] } = {}) {
  const uids = [...new Set((requireUserRows || []).filter((u) => typeof u === 'string' && u))];
  if (uids.length === 0) {
    return db.prepare(
      `UPDATE stripe_event_ledger
       SET status = 'processed', processed_at = datetime('now'), last_error = NULL
       WHERE event_id = ?`
    ).bind(eventId);
  }
  const placeholders = uids.map((_, i) => `?${i + 2}`).join(', ');
  return db.prepare(
    `UPDATE stripe_event_ledger
     SET status = CASE WHEN (SELECT COUNT(*) FROM users WHERE auth_id IN (${placeholders})) = ${uids.length} THEN 'processed' ELSE NULL END,
         processed_at = datetime('now'), last_error = NULL
     WHERE event_id = ?1`
  ).bind(eventId, ...uids);
}

// Distinct marker for the recipient guard above (SQLite/D1 wording).
export const RECIPIENT_GUARD_ERROR = 'NOT NULL constraint failed: stripe_event_ledger.status';

/**
 * Record a critical failure so the event is operator-visible and retryable.
 * Never demotes a processed row. Best-effort: if this UPDATE itself fails,
 * the row stays 'processing' and the stale-claim window recovers it.
 */
export async function markEventFailed(env, eventId, reasonLabel) {
  const db = getDb(env);
  if (!db) return;
  try {
    await db.prepare(
      `UPDATE stripe_event_ledger
       SET status = 'failed', last_error = ?2
       WHERE event_id = ?1 AND status != 'processed'`
    ).bind(eventId, String(reasonLabel || 'unknown').slice(0, 120)).run();
  } catch (err) {
    console.error(`[EVENT-LEDGER] failed to mark ${redactId(eventId)} failed (${err?.message || err}); stale-claim window will recover it`);
  }
}
