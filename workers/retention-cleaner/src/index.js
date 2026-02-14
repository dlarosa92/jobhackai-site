// Data retention cleaner
// Deletes records older than 90 days across all tool history tables.
// Runs daily at 03:00 UTC via cron trigger.

const RETENTION_DAYS = 90;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCleanup(env));
  }
};

async function runCleanup(env) {
  const db = env.JOBHACKAI_DB;
  if (!db || typeof db.prepare !== 'function') {
    console.warn('[retention-cleaner] JOBHACKAI_DB not bound');
    return;
  }

  // Use SQLite datetime format (YYYY-MM-DD HH:MM:SS) to match datetime('now') columns
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoff = cutoffDate.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const cutoffMs = cutoffDate.getTime();
  const results = {};

  // 1. LinkedIn runs (existing logic — uses epoch ms and is_pinned)
  results.linkedin_runs = await deleteRows(
    db,
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

  if (!env.JOBHACKAI_KV) {
    console.warn('[retention-cleaner] JOBHACKAI_KV not bound — skipping KV cleanup for resume sessions');
  } else {
    try {
      const sessions = await db.prepare(
        `SELECT id, raw_text_location FROM resume_sessions WHERE ${resumeCleanupCondition}`
      ).bind(...resumeBinds).all();
      const rows = sessions.results || [];
      for (const session of rows) {
        if (session.raw_text_location) {
          try {
            await env.JOBHACKAI_KV.delete(session.raw_text_location);
          } catch (_) {}
        }
        try {
          await env.JOBHACKAI_KV.delete(`resume:${session.id}`);
        } catch (_) {}
      }
      console.log(`[retention-cleaner] Cleaned up KV for ${rows.length} resume sessions`);
    } catch (kvErr) {
      console.warn('[retention-cleaner] KV cleanup error:', kvErr?.message || kvErr);
    }
  }

  // 3. Feedback sessions — delete by own created_at, not parent resume's.
  // upsertResumeSessionWithScores reuses old resume rows, so feedback linked to
  // an old resume may still be recent. Also delete orphaned feedback whose
  // parent resume is being removed (FK safety).
  results.feedback_sessions = await deleteRows(
    db,
    'DELETE FROM feedback_sessions WHERE created_at < ?',
    cutoff
  );

  // 4. Resume sessions — skip rows that still have recent feedback (active reuse)
  results.resume_sessions = await deleteRows(
    db,
    `DELETE FROM resume_sessions WHERE ${resumeCleanupCondition}`,
    ...resumeBinds
  );

  // 5. Interview question sets
  results.interview_question_sets = await deleteRows(
    db,
    'DELETE FROM interview_question_sets WHERE created_at < ?',
    cutoff
  );

  // 6. Mock interview sessions
  results.mock_interview_sessions = await deleteRows(
    db,
    'DELETE FROM mock_interview_sessions WHERE created_at < ?',
    cutoff
  );

  // 7. Cover letter history (created_at is epoch ms, not ISO string)
  results.cover_letter_history = await deleteRows(
    db,
    'DELETE FROM cover_letter_history WHERE created_at < ?',
    cutoffMs
  );

  // 8. Usage events
  results.usage_events = await deleteRows(
    db,
    'DELETE FROM usage_events WHERE created_at < ?',
    cutoff
  );

  console.log('[retention-cleaner] cleanup complete', results);
}

async function checkColumnExists(db, table, column) {
  try {
    const info = await db.prepare(`PRAGMA table_info('${table}')`).all();
    const columns = new Set((info.results || []).map(r => r.name));
    return columns.has(column);
  } catch (_) {
    return false;
  }
}

async function deleteRows(db, sql, ...binds) {
  try {
    const res = await db.prepare(sql).bind(...binds).run();
    const changes =
      typeof res?.meta?.changes === 'number'
        ? res.meta.changes
        : typeof res?.changes === 'number'
          ? res.changes
          : null;
    return changes;
  } catch (e) {
    console.error(`[retention-cleaner] delete failed: ${sql}`, e?.message || e);
    return null;
  }
}
