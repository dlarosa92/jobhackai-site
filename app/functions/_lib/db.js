// Return a D1 database handle, or null if not available
export function getDb(env) {
  return env.DB ?? env.jobhackai_DB ?? null;
}

// Atomic attempt to reserve a free ATS usage (returns true if succeeded, false if already used)
export async function claimFreeATSUsage(env, userId) {
  const db = getDb(env);
  if (!db) throw new Error('D1 unavailable');
  try {
    await db.prepare(`
      INSERT INTO usage_events (user_id, feature, tokens_used, meta_json, created_at)
      VALUES (?, 'ats_score', null, NULL, datetime('now'))
    `).bind(userId).run();
    return true; // First to insert wins
  } catch (e) {
    const msg = String(e.message).toLowerCase();
    if (msg.includes('unique') || msg.includes('constraint') || msg.includes('duplicate')) {
      return false; // Already claimed in another request
    }
    throw e;
  }
}

