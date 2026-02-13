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

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const results = {};

  // 1. LinkedIn runs (existing logic — uses epoch ms and is_pinned)
  results.linkedin_runs = await deleteRows(
    db,
    'DELETE FROM linkedin_runs WHERE is_pinned = 0 AND created_at < ?',
    cutoffMs
  );

  // 2. Resume sessions — first clean up KV keys, then delete
  if (env.JOBHACKAI_KV) {
    try {
      const sessions = await db.prepare(
        'SELECT id, raw_text_location FROM resume_sessions WHERE created_at < ?'
      ).bind(cutoff).all();
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

  // 3. Feedback sessions (must delete before resume_sessions due to FK)
  results.feedback_sessions = await deleteRows(
    db,
    'DELETE FROM feedback_sessions WHERE resume_session_id IN (SELECT id FROM resume_sessions WHERE created_at < ?)',
    cutoff
  );

  // 4. Resume sessions
  results.resume_sessions = await deleteRows(
    db,
    'DELETE FROM resume_sessions WHERE created_at < ?',
    cutoff
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

async function deleteRows(db, sql, bind) {
  try {
    const res = await db.prepare(sql).bind(bind).run();
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
