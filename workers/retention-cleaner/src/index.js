// LinkedIn Optimizer retention cleaner
// Deletes non-pinned runs older than 90 days (D1 is source of truth).

const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

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

  const cutoff = Date.now() - RETENTION_MS;
  try {
    const res = await db
      .prepare(
        `DELETE FROM linkedin_runs
         WHERE is_pinned = 0 AND created_at < ?`
      )
      .bind(cutoff)
      .run();

    const changes =
      typeof res?.meta?.changes === 'number'
        ? res.meta.changes
        : typeof res?.changes === 'number'
          ? res.changes
          : null;

    console.log('[retention-cleaner] cleanup complete', { cutoff, deleted: changes });
  } catch (e) {
    console.error('[retention-cleaner] cleanup failed', e?.message || e);
  }
}

