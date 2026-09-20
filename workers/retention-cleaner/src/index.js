// Data retention cleaner
// Deletes records older than 90 days across all tool history tables.
// Runs hourly in bounded account batches; audit is the default.

const RETENTION_DAYS = 90;
import { isDevCutoverPaused } from '../../../app/functions/_lib/dev-cutover.js';
import { admitAccountOperation, settleAccountOperation } from '../../../app/functions/_lib/account-deletion-admission.js';

const ACCOUNT_BATCH = 25;
const RESUME_BATCH = 10;

export default {
  async scheduled(event, env, ctx) {
    if (isDevCutoverPaused(env)) return;
    ctx.waitUntil(runCleanup(env));
  }
};

export async function runCleanup(env, { afterUserId } = {}) {
  const sourceDb = env.JOBHACKAI_DB;
  if (!sourceDb || typeof sourceDb.prepare !== 'function') throw new Error('Retention database binding missing');
  if (!env.JOBHACKAI_KV || typeof env.JOBHACKAI_KV.delete !== 'function') throw new Error('Retention KV binding missing');
  if (!await checkColumnExists(sourceDb, 'voice_sessions', 'id')) throw new Error('Voice retention schema missing');
  const audit = env.RETENTION_MODE !== 'delete';
  if (afterUserId !== undefined && (!audit || !Number.isSafeInteger(afterUserId) || afterUserId < 0)) throw new Error('Retention audit cursor invalid');
  const cursor = await sourceDb.prepare("SELECT last_user_id,revision FROM account_maintenance_cursors WHERE name='retention'").first();
  const after = afterUserId ?? cursor?.last_user_id ?? 0;
  // These legacy tables use Firebase UIDs without a users FK. Do not silently
  // omit unmapped content or invent an owner to erase it; surface it for the
  // migration/ownership reconciliation that precedes retention activation.
  let unmappedUidRows = 0;
  try {
    for (const table of ['linkedin_runs', 'cover_letter_history']) {
      const row = await sourceDb.prepare(`SELECT COUNT(*) AS count FROM ${table} h
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.auth_id=h.user_id)`).first();
      unmappedUidRows += row.count;
    }
  } catch (_) { throw new Error('Retention database operation failed'); }
  const candidates = await sourceDb.prepare(`SELECT id,auth_id FROM users u WHERE id>?
    AND NOT EXISTS (SELECT 1 FROM account_deletion_admissions d WHERE d.auth_id=u.auth_id)
    AND NOT EXISTS (SELECT 1 FROM deleted_auth_ids d WHERE d.auth_id=u.auth_id)
    AND NOT EXISTS (SELECT 1 FROM account_operation_claims c WHERE c.auth_id=u.auth_id AND c.state!='finished')
    ORDER BY id LIMIT ?`).bind(after, ACCOUNT_BATCH + 1).all();
  const owners = candidates.results.slice(0, ACCOUNT_BATCH);
  const results = { mode: audit ? 'audit' : 'delete', accounts: 0, accounts_skipped: 0, unmapped_uid_rows: unmappedUidRows, after_user_id: after,
    next_user_id: candidates.results.length > ACCOUNT_BATCH ? owners.at(-1).id : 0,
    linkedin_runs: 0, resume_sessions: 0, resume_kv_sessions: 0, resume_accounts_with_more_payloads: 0, feedback_sessions: 0,
    interview_question_sets: 0, mock_interview_sessions: 0, cover_letter_history: 0,
    usage_events: 0, voice_sessions_stripped: 0, voice_sessions: 0 };
  if (audit) results.kv_keys_would_delete = 0;
  // Audit reads the same bounded batch and predicates, with no claims or cursor writes.
  for (const owner of owners) {
    let claim = null;
    try {
      if (!audit) {
        try { claim = await admitAccountOperation(env, owner.auth_id, 'maintenance',{purpose:'retention'}); }
        catch (error) {
          if (['account_operation_busy', 'account_deletion_pending'].includes(error?.message)) { results.accounts_skipped++; continue; }
          throw error;
        }
        const current = await sourceDb.prepare('SELECT auth_id FROM users WHERE id=?').bind(owner.id).first();
        if (current?.auth_id !== owner.auth_id) throw new Error('Retention owner changed');
      }
      const counts = await cleanupOwner(env, sourceDb, owner);
      if (claim) { await settleAccountOperation(env, claim, 'finished'); claim = null; }
      for (const [key, value] of Object.entries(counts)) if (key !== 'mode') results[key] += value;
      results.accounts++;
    } catch (error) {
      if (claim) {
        try { await settleAccountOperation(env, claim, 'uncertain'); } catch (_) { /* Preserve active claim. */ }
      }
      throw error; // No cursor advance or false successful cleanup on partial failure.
    }
  }
  if (!audit) {
    // Compare revisions so a slower overlapping schedule cannot move the cursor
    // backward after another run advanced it. Repeating a batch is harmless.
    const result = cursor
      ? await sourceDb.prepare("UPDATE account_maintenance_cursors SET last_user_id=?,revision=revision+1,updated_at=datetime('now') WHERE name='retention' AND revision=?").bind(results.next_user_id, cursor.revision).run()
      : await sourceDb.prepare("INSERT INTO account_maintenance_cursors(name,last_user_id,revision) VALUES('retention',?,1) ON CONFLICT(name) DO NOTHING").bind(results.next_user_id).run();
    results.cursor_advanced = result.meta?.changes === 1;
  }
  console.log('[retention-cleaner] cleanup batch complete', results);
  return results;
}

async function cleanupOwner(env, sourceDb, owner) {
  // An explicit operator choice is required before a new deployment deletes
  // anything. Audit uses the identical predicates, but only executes SELECTs.
  const audit = env.RETENTION_MODE !== 'delete';
  const db = audit ? auditDatabase(sourceDb) : sourceDb;
  let kvKeys = 0;
  const kv = audit ? { delete: async () => { kvKeys++; } } : env.JOBHACKAI_KV;
  const hasVoiceSessions = await checkColumnExists(db, 'voice_sessions', 'id');
  if (!hasVoiceSessions) throw new Error('Voice retention schema missing');

  // Use SQLite datetime format (YYYY-MM-DD HH:MM:SS) to match datetime('now') columns
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoff = cutoffDate.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const cutoffMs = cutoffDate.getTime();
  const results = { mode: audit ? 'audit' : 'delete' };

  // 1. LinkedIn runs (existing logic — uses epoch ms and is_pinned)
  results.linkedin_runs = await deleteRows(
    db, owner,
    'DELETE FROM linkedin_runs WHERE is_pinned = 0 AND created_at < ?',
    cutoffMs
  );

  // 2. Resume sessions — first clean up KV keys, then delete
  // Keep sessions that were recently updated (ATS scoring refreshes updated_at)
  // OR that have recent feedback_sessions.
  // The updated_at column may not exist if migration 016 hasn't been applied yet;
  // detect this and fall back to a simpler condition using only created_at.
  const hasUpdatedAt = await checkColumnExists(db, 'resume_sessions', 'updated_at');
  const resumeCleanupCondition = hasUpdatedAt
    ? `created_at < ?
       AND (updated_at IS NULL OR updated_at < ?)
       AND id NOT IN (
         SELECT DISTINCT resume_session_id FROM feedback_sessions WHERE created_at >= ?
       )`
    : `created_at < ?
       AND id NOT IN (
         SELECT DISTINCT resume_session_id FROM feedback_sessions WHERE created_at >= ?
       )`;
  const resumeBinds = hasUpdatedAt ? [cutoff, cutoff, cutoff] : [cutoff, cutoff];

  let resumeIds = [];
  {
    try {
      const sessions = await db.prepare(
        `SELECT id, raw_text_location FROM resume_sessions WHERE ${resumeCleanupCondition} AND user_id=? ORDER BY id LIMIT ${RESUME_BATCH + 1}`
      ).bind(...resumeBinds, owner.id).all();
      const candidates = sessions.results || [];
      const rows = candidates.slice(0, RESUME_BATCH);
      results.resume_accounts_with_more_payloads = candidates.length > RESUME_BATCH ? 1 : 0;
      resumeIds = rows.map(row => row.id);
      for (const session of rows) {
        if (session.raw_text_location) {
          await kv.delete(session.raw_text_location);
        }
        await kv.delete(`resume:${session.id}`);
      }
      results.resume_kv_sessions = rows.length;
      if (audit) results.kv_keys_would_delete = kvKeys;
    } catch (_) {
      // Keep the D1 rows that locate the KV payload so a later run can retry.
      throw new Error('Resume payload cleanup failed; database references retained');
    }
  }

  // 3. Feedback sessions — delete by own created_at, not parent resume's.
  // upsertResumeSessionWithScores reuses old resume rows, so feedback linked to
  // an old resume may still be recent. Also delete orphaned feedback whose
  // parent resume is being removed (FK safety).
  results.feedback_sessions = await deleteRows(
    db, owner,
    'DELETE FROM feedback_sessions WHERE created_at < ?',
    cutoff
  );

  // 4. Resume sessions — skip rows that still have recent feedback (active reuse)
  results.resume_sessions = resumeIds.length ? await deleteRows(
    db, owner,
    `DELETE FROM resume_sessions WHERE ${resumeCleanupCondition} AND id IN (${resumeIds.map(() => '?').join(',')})`,
    ...resumeBinds, ...resumeIds
  ) : 0;

  // 5. Interview question sets
  results.interview_question_sets = await deleteRows(
    db, owner,
    'DELETE FROM interview_question_sets WHERE created_at < ?',
    cutoff
  );

  // 6. Mock interview sessions
  results.mock_interview_sessions = await deleteRows(
    db, owner,
    'DELETE FROM mock_interview_sessions WHERE created_at < ?',
    cutoff
  );

  // 7. Cover letter history (created_at is epoch ms, not ISO string)
  results.cover_letter_history = await deleteRows(
    db, owner,
    'DELETE FROM cover_letter_history WHERE created_at < ?',
    cutoffMs
  );

  // 8. Usage events
  results.usage_events = await deleteRows(
    db, owner,
    'DELETE FROM usage_events WHERE created_at < ?',
    cutoff
  );

  // 9. Voice sessions — same 90-day rule as mock interviews, with the
  // free-taste carve-out: a user with no active voice plan (no live
  // subscription, no usable pack credits) keeps their most recent session
  // row as metadata so it stays visible in history, but its transcript,
  // scorecard and supplied role/job context are stripped (the report is locked once past retention).
  // Entitled users' aged sessions are deleted exactly like typed sessions.
  if (hasVoiceSessions) {
    // Mirrors getVoiceEntitlement (app/functions/_lib/voice-entitlements.js):
    // active subscription = eligible plan label + live Stripe status + period
    // not lapsed beyond the 3-day grace; usable pack = credits > 0, not expired.
    const activeVoicePlan = `COALESCE((
        (u.plan IN ('weekly','monthly','trial','essential','pro','premium')
         AND u.subscription_status IN ('active','trialing','past_due','unpaid')
         AND (u.current_period_end IS NULL OR u.current_period_end = '' OR datetime(u.current_period_end) > datetime('now','-3 days')))
        OR (u.voice_sessions_remaining > 0
         AND (u.pack_expires_at IS NULL OR u.pack_expires_at = '' OR datetime(u.pack_expires_at) > datetime('now')))
      ), 0)`;
    // Newest COMPLETED row only: the history list ignores created/active/
    // abandoned rows, so a newer incomplete session must not steal the
    // carve-out from the completed session the list actually keeps.
    const carveOutIds = `SELECT vs.id FROM voice_sessions vs
        JOIN users u ON u.id = vs.user_id
        WHERE vs.started_at < ?
          AND NOT ${activeVoicePlan}
          AND vs.id = (
            SELECT v2.id FROM voice_sessions v2
            WHERE v2.user_id = vs.user_id AND v2.status = 'completed'
            ORDER BY v2.started_at DESC, v2.id DESC LIMIT 1
          )`;
    results.voice_sessions_stripped = await deleteRows(
      db, owner,
      `UPDATE voice_sessions SET transcript_json = NULL, scorecard_json = NULL, role = NULL, seniority = NULL, jd_excerpt = NULL, updated_at = datetime('now')
       WHERE id IN (${carveOutIds})
         AND (transcript_json IS NOT NULL OR scorecard_json IS NOT NULL OR role IS NOT NULL OR seniority IS NOT NULL OR jd_excerpt IS NOT NULL)`,
      cutoff
    );
    results.voice_sessions = await deleteRows(
      db, owner,
      `DELETE FROM voice_sessions WHERE started_at < ? AND id NOT IN (${carveOutIds})`,
      cutoff,
      cutoff
    );
  }

  return results;
}

// This adapter exposes no mutation path. Known cleanup statements are turned
// into counts; unknown statements fail closed instead of reaching D1.run().
function auditDatabase(source) {
  return { prepare(sql) {
    let binds = [];
    const statement = {
      bind(...values) { binds = values; return statement; },
      async all() {
        if (!/^\s*(SELECT\b|PRAGMA table_info\()/i.test(sql)) throw new Error('Unexpected retention audit read');
        const query = source.prepare(sql);
        return binds.length ? query.bind(...binds).all() : query.all();
      },
      async run() {
        let query;
        const deletion = sql.match(/^\s*DELETE FROM (\w+) WHERE ([\s\S]+)$/i);
        const stripping = sql.match(/^\s*UPDATE voice_sessions SET transcript_json = NULL, scorecard_json = NULL, role = NULL, seniority = NULL, jd_excerpt = NULL, updated_at = datetime\('now'\)\s+WHERE ([\s\S]+)$/i);
        if (deletion) query = `SELECT COUNT(*) AS count FROM ${deletion[1]} WHERE ${deletion[2]}`;
        else if (stripping) query = `SELECT COUNT(*) AS count FROM voice_sessions WHERE ${stripping[1]}`;
        else throw new Error('Unexpected retention audit operation');
        const result = await source.prepare(query).bind(...binds).first();
        return { meta: { changes: Number(result?.count || 0) } };
      }
    };
    return statement;
  } };
}

async function checkColumnExists(db, table, column) {
  try {
    const info = await db.prepare(`PRAGMA table_info('${table}')`).all();
    const columns = new Set((info.results || []).map(r => r.name));
    return columns.has(column);
  } catch (_) {
    throw new Error('Retention schema check failed');
  }
}

async function deleteRows(db, owner, sql, ...binds) {
  const table = sql.match(/^(?:DELETE FROM|UPDATE) (\w+)\b/)?.[1];
  const directIds = ['resume_sessions','interview_question_sets','mock_interview_sessions','usage_events','voice_sessions'];
  const authIds = ['linkedin_runs','cover_letter_history'];
  let predicate, value;
  if (directIds.includes(table)) { predicate = `${table}.user_id=?`; value = owner.id; }
  else if (authIds.includes(table)) { predicate = `${table}.user_id=?`; value = owner.auth_id; }
  else if (table === 'feedback_sessions') { predicate = 'resume_session_id IN (SELECT id FROM resume_sessions WHERE user_id=?)'; value = owner.id; }
  else throw new Error('Retention scope invalid');
  try {
    const res = await db.prepare(`${sql} AND ${predicate}`).bind(...binds, value).run();
    const changes =
      typeof res?.meta?.changes === 'number'
        ? res.meta.changes
        : typeof res?.changes === 'number'
          ? res.changes
          : null;
    if (!Number.isSafeInteger(changes) || changes < 0) throw new Error('Retention change count unavailable');
    return changes;
  } catch (_) {
    throw new Error('Retention database operation failed');
  }
}
