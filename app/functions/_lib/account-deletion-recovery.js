import { getDb } from './db.js';
import { assertDeletionQuiescent } from './account-deletion-admission.js';
import { billingCacheKeysForUid } from './billing-utils.js';

// Storage/recovery primitive only. Do not wire to production until the handler,
// identity reconciliation, request admission and recovery runner are integrated.
const uidTables = ['linkedin_runs', 'role_usage_log', 'cover_letter_history'];
const userTables = [
  'feature_daily_usage', 'cookie_consents', 'usage_events',
  'interview_question_sets', 'mock_interview_sessions', 'mock_interview_usage',
  'first_resume_snapshots', 'voice_sessions', 'checkout_attributions'
];
const transitions = new Map([
  ['billing_verified', 'prepared'],
  ['identity_removed', 'billing_verified']
]);

function database(env) {
  const db = getDb(env);
  if (!db || typeof db.batch !== 'function') throw new Error('deletion_database_unavailable');
  return db;
}

function validateUid(uid) {
  if (typeof uid !== 'string' || !uid || uid.length > 128) throw new Error('deletion_identity_invalid');
}

function validKeys(keys) {
  if (!Array.isArray(keys) || keys.length > 10000 ||
      keys.some(key => typeof key !== 'string' || !key || key.length > 512)) {
    throw new Error('deletion_manifest_invalid');
  }
  return [...new Set(keys)];
}

async function resumeKeys(db, userId) {
  if (userId == null) return [];
  const rows = (await db.prepare(
    'SELECT id, raw_text_location FROM resume_sessions WHERE user_id = ?'
  ).bind(userId).all()).results;
  if (!Array.isArray(rows)) throw new Error('deletion_manifest_unavailable');
  return rows.flatMap(row => [row.raw_text_location, `resume:${row.id}`].filter(Boolean));
}

/** Save the recoverable manifest before billing or identity side effects.
 * Callers must hold the account's deletion admission lock. Concurrent creation
 * is idempotent, but this function does not itself block application writes. */
export async function prepareDeletionRecovery(env, { uid, email = null }) {
  validateUid(uid);
  await assertDeletionQuiescent(env, uid);
  const db = database(env);
  const existing = await db.prepare('SELECT * FROM account_deletion_jobs WHERE auth_id = ?').bind(uid).first();
  if (existing) return existing;
  const user = await db.prepare('SELECT id, email FROM users WHERE auth_id = ?').bind(uid).first();
  const keys = validKeys([
    ...await resumeKeys(db, user?.id),
    `cusByUid:${uid}`, ...billingCacheKeysForUid(uid),
    `user:${uid}:lastResume`, `atsUsage:${uid}:lifetime`, `usage:${uid}`
  ]);
  await db.prepare(`
    INSERT INTO account_deletion_jobs(id, auth_id, user_id, email, kv_keys_json)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(auth_id) DO NOTHING
  `).bind(crypto.randomUUID(), uid, user?.id ?? null, user?.email || email, JSON.stringify(keys)).run();
  const job = await db.prepare('SELECT * FROM account_deletion_jobs WHERE auth_id = ?').bind(uid).first();
  if (!job) throw new Error('deletion_manifest_not_saved');
  return job;
}

/** Persist only confirmed progress. An interrupted identity call stays in
 * billing_verified; the runner must reconcile Firebase, not assume success. */
export async function advanceDeletionRecovery(env, id, phase) {
  const previous = transitions.get(phase);
  if (!previous) throw new Error('deletion_transition_invalid');
  const db = database(env);
  const existing = await db.prepare('SELECT auth_id FROM account_deletion_jobs WHERE id = ?').bind(id).first();
  if (!existing) throw new Error('deletion_job_missing');
  await assertDeletionQuiescent(env, existing.auth_id);
  await db.prepare(`UPDATE account_deletion_jobs SET phase = ?, last_error_code = NULL,
    updated_at = datetime('now') WHERE id = ? AND phase = ?`).bind(phase, id, previous).run();
  const job = await db.prepare('SELECT * FROM account_deletion_jobs WHERE id = ?').bind(id).first();
  if (!job || job.phase !== phase) throw new Error('deletion_transition_conflict');
  return job;
}

/** Finish an identity-confirmed job. KV failures retain every SQL reference and
 * the original manifest; D1 erasure and completion are one atomic transaction.
 * Financial captures/refunds/ledger history are intentionally retained. */
export async function finishDeletionRecovery(env, id) {
  const db = database(env);
  const job = await db.prepare('SELECT * FROM account_deletion_jobs WHERE id = ?').bind(id).first();
  if (!job) throw new Error('deletion_job_missing');
  if (job.phase === 'complete') return { complete: true, alreadyComplete: true };
  if (job.phase !== 'identity_removed') throw new Error('deletion_identity_unconfirmed');
  validateUid(job.auth_id);
  await assertDeletionQuiescent(env, job.auth_id);
  if (typeof env.JOBHACKAI_KV?.delete !== 'function') throw new Error('deletion_cache_unavailable');

  let stage = 'manifest';
  try {
    const current = await db.prepare('SELECT id FROM users WHERE auth_id = ?').bind(job.auth_id).first();
    const original = job.user_id == null ? null : await db.prepare('SELECT auth_id FROM users WHERE id = ?').bind(job.user_id).first();
    if ((current && current.id !== job.user_id) || (original && original.auth_id !== job.auth_id)) {
      throw new Error('deletion_identity_conflict');
    }
    const keys = validKeys([
      ...validKeys(JSON.parse(job.kv_keys_json)),
      ...await resumeKeys(db, job.user_id)
    ]);
    // Keep newly discovered references durable before deleting any of them.
    await db.prepare(`UPDATE account_deletion_jobs SET kv_keys_json = ?, attempts = attempts + 1,
      updated_at = datetime('now') WHERE id = ? AND phase = 'identity_removed'`)
      .bind(JSON.stringify(keys), id).run();

    stage = 'tombstone';
    // D1 is authoritative. Never continue if this write fails.
    await db.prepare(`INSERT INTO deleted_auth_ids(auth_id, email, deleted_at)
      VALUES (?, ?, datetime('now')) ON CONFLICT(auth_id) DO UPDATE SET
      email = COALESCE(deleted_auth_ids.email, excluded.email)`)
      .bind(job.auth_id, job.email).run();

    stage = 'cache';
    for (const key of keys) await env.JOBHACKAI_KV.delete(key);

    stage = 'database';
    const statements = [];
    // A changed owner or phase makes this NOT NULL violation roll back the
    // entire batch. A preflight read alone cannot protect against a race.
    statements.push(db.prepare(`UPDATE account_deletion_jobs SET phase = CASE
      WHEN phase = 'identity_removed'
        AND NOT EXISTS(SELECT 1 FROM users WHERE auth_id = ? AND id IS NOT ?)
        AND NOT EXISTS(SELECT 1 FROM users WHERE id = ? AND auth_id <> ?)
      THEN phase ELSE NULL END WHERE id = ?`)
      .bind(job.auth_id, job.user_id, job.user_id, job.auth_id, id));
    for (const table of uidTables) statements.push(db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(job.auth_id));
    if (job.user_id != null) {
      statements.push(db.prepare('DELETE FROM feedback_sessions WHERE resume_session_id IN (SELECT id FROM resume_sessions WHERE user_id = ?)').bind(job.user_id));
      for (const table of userTables) statements.push(db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(job.user_id));
      statements.push(db.prepare('DELETE FROM resume_sessions WHERE user_id = ?').bind(job.user_id));
      statements.push(db.prepare('DELETE FROM users WHERE id = ? AND auth_id = ?').bind(job.user_id, job.auth_id));
    }
    // The retained operational receipt contains no email or resume paths.
    statements.push(db.prepare(`UPDATE account_deletion_jobs SET phase = 'complete',
      email = NULL, kv_keys_json = '[]', last_error_code = NULL,
      completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND phase = 'identity_removed'`).bind(id));
    statements.push(db.prepare("DELETE FROM account_operation_claims WHERE auth_id = ? AND state = 'finished'").bind(job.auth_id));
    statements.push(db.prepare("UPDATE account_deletion_admissions SET state = 'complete', email = NULL, updated_at = datetime('now') WHERE auth_id = ?").bind(job.auth_id));
    await db.batch(statements);
    return { complete: true, alreadyComplete: false };
  } catch (error) {
    // Keep only a coarse stage, not provider errors or personal data.
    await db.prepare(`UPDATE account_deletion_jobs SET last_error_code = ?,
      updated_at = datetime('now') WHERE id = ? AND phase <> 'complete'`)
      .bind(`cleanup_${stage}_failed`, id).run().catch(() => {});
    throw error;
  }
}
