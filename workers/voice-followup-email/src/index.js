/**
 * Voice follow-up email worker (repositioning brief section 4)
 *
 * Hourly cron with two jobs:
 *
 * 1. The single 48h follow-up email: free users whose free voice session
 *    completed more than 48 hours ago, with no purchase since, get exactly
 *    one helpful email containing the concrete improvement tip from their
 *    own session plus the upgrade link. One email ever, no drip. The
 *    voice_followup_email_sent_at column is claimed BEFORE sending so a
 *    crashed run can never double-send.
 *
 * 2. Housekeeping: voice sessions stuck in created/active for over an hour
 *    are marked abandoned (tab killed mid-interview, etc.).
 */

const FOLLOWUP_DELAY_HOURS = 48;
const BATCH_LIMIT = 50;

function enabled(env) {
  return String(env.VOICE_INTERVIEW_ENABLED || '').toLowerCase() === 'true';
}

function followupEmail({ userName, tip, frontendUrl }) {
  const safeTip = tip && tip.length > 10
    ? tip
    : 'Pick the one answer that felt weakest and rerun it out loud until it lands in under two minutes.';
  const subject = 'One thing to fix from your mock interview';
  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 540px; margin: 0 auto; color: #1F2937;">
    <h2 style="color: #1F2937;">Hi ${userName},</h2>
    <p>You ran your free voice mock interview a couple of days ago. From your session, here is the one improvement worth practicing first:</p>
    <div style="background: #F9FAFB; border-left: 4px solid #FF9100; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
      <p style="margin: 0; color: #374151;">${safeTip}</p>
    </div>
    <p>The fastest way to fix it is to say the answer out loud again, not to think about it. Your full report, transcript, and unlimited practice sessions are one step away.</p>
    <p style="margin: 24px 0;">
      <a href="${frontendUrl}/pricing" style="background: #00E676; color: #1F2937; font-weight: 700; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Keep practicing</a>
    </p>
    <p style="color: #6B7280; font-size: 13px;">This is the only reminder we will send about your session. Good luck out there.</p>
    <p style="color: #6B7280; font-size: 13px;">JobHackAI</p>
  </div>`;
  return { subject, html };
}

async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.warn('[VOICE-FOLLOWUP] RESEND_API_KEY not set; skipping send');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'JobHackAI <noreply@jobhackai.io>',
      to: [to],
      subject,
      html
    })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[VOICE-FOLLOWUP] Resend error ${res.status}: ${err.slice(0, 200)}`);
    return false;
  }
  return true;
}

async function sweepStaleSessions(db) {
  const res = await db.prepare(
    `UPDATE voice_sessions SET status = 'abandoned', updated_at = datetime('now')
     WHERE status IN ('created', 'active')
       AND started_at < datetime('now', '-60 minutes')`
  ).run();
  const swept = res?.meta?.changes ?? 0;
  if (swept > 0) console.log(`[VOICE-FOLLOWUP] Marked ${swept} stale session(s) abandoned`);
}

async function sendFollowups(env, db) {
  // Candidates: free-taste used 48h+ ago, never emailed, still unconverted
  // (no subscription plan, no pack credits, never paid).
  const rows = await db.prepare(
    `SELECT u.id, u.auth_id, u.email, vs.scorecard_json, vs.ended_at
     FROM users u
     JOIN voice_sessions vs ON vs.user_id = u.id AND vs.entitlement_mode = 'free' AND vs.status = 'completed'
     WHERE u.free_session_used = 1
       AND u.voice_followup_email_sent_at IS NULL
       AND u.plan = 'free'
       AND COALESCE(u.voice_sessions_remaining, 0) = 0
       AND COALESCE(u.has_ever_paid, 0) = 0
       AND u.email IS NOT NULL
       AND vs.ended_at < datetime('now', '-${FOLLOWUP_DELAY_HOURS} hours')
     LIMIT ${BATCH_LIMIT}`
  ).all();

  const candidates = rows?.results || [];
  if (candidates.length === 0) return;

  console.log(`[VOICE-FOLLOWUP] ${candidates.length} candidate(s) for the 48h email`);

  for (const row of candidates) {
    try {
      // Claim before send so two overlapping cron runs cannot both send. If the
      // send then fails (Resend error, or RESEND_API_KEY unset), roll the claim
      // back to NULL so the user stays eligible and a later run retries. This
      // keeps the "exactly one email" guarantee without permanently dropping it
      // on a transient send failure.
      const claim = await db.prepare(
        `UPDATE users SET voice_followup_email_sent_at = datetime('now')
         WHERE id = ? AND voice_followup_email_sent_at IS NULL`
      ).bind(row.id).run();
      if ((claim?.meta?.changes ?? 0) !== 1) continue;

      let tip = null;
      try { tip = JSON.parse(row.scorecard_json || '{}').topImprovement || null; } catch (_) {}

      const userName = String(row.email).split('@')[0];
      const { subject, html } = followupEmail({
        userName,
        tip,
        frontendUrl: env.FRONTEND_URL || 'https://app.jobhackai.io'
      });
      const sent = await sendEmail(env, { to: row.email, subject, html });
      if (!sent) {
        // Release the claim so this user is retried on a future run.
        await db.prepare(
          `UPDATE users SET voice_followup_email_sent_at = NULL WHERE id = ?`
        ).bind(row.id).run().catch(() => {});
      }
      console.log(`[VOICE-FOLLOWUP] ${sent ? 'Sent' : 'FAILED (claim released for retry)'} 48h email to user ${row.id}`);
    } catch (err) {
      console.error(`[VOICE-FOLLOWUP] Error for user ${row.id}:`, err?.message || err);
    }
  }
}

export default {
  async scheduled(event, env, ctx) {
    const db = env.JOBHACKAI_DB;
    if (!db) {
      console.error('[VOICE-FOLLOWUP] No D1 binding');
      return;
    }

    try {
      await sweepStaleSessions(db);
    } catch (err) {
      // Pre-migration-020 environments: table does not exist yet
      console.warn('[VOICE-FOLLOWUP] Sweep skipped:', err?.message || err);
    }

    if (!enabled(env)) {
      console.log('[VOICE-FOLLOWUP] VOICE_INTERVIEW_ENABLED is off; no emails');
      return;
    }

    try {
      await sendFollowups(env, db);
    } catch (err) {
      console.error('[VOICE-FOLLOWUP] Follow-up pass failed:', err?.message || err);
    }
  }
};
