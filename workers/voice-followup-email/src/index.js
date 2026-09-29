/**
 * Voice follow-up email worker (repositioning brief section 4)
 *
 * Hourly cron with two jobs:
 *
 * 1. The single 48h follow-up email: free users whose free voice session
 *    completed more than 48 hours ago, with no purchase since, are eligible
 *    for one helpful email containing the concrete improvement tip from their
 *    own session plus the upgrade link. No drip. The send marker is claimed
 *    BEFORE sending. Ambiguous delivery stays claimed for reconciliation;
 *    it is never automatically retried as though it definitely failed.
 *
 * 2. Housekeeping: voice sessions stuck in created/active for over an hour
 *    are marked abandoned (tab killed mid-interview, etc.).
 */

import { admitAccountOperation, settleAccountOperation } from '../../../app/functions/_lib/account-deletion-admission.js';
import { isDevCutoverPaused } from '../../../app/functions/_lib/dev-cutover.js';

const FOLLOWUP_DELAY_HOURS = 48;
const BATCH_LIMIT = 50;

function enabled(env) {
  return String(env.VOICE_INTERVIEW_ENABLED || '').toLowerCase() === 'true';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function frontend(env) {
  const value = env.FRONTEND_URL || 'https://app.jobhackai.io';
  return ['https://dev.jobhackai.io', 'https://qa.jobhackai.io', 'https://app.jobhackai.io'].includes(value) ? value : null;
}

function followupEmail({ userName, tip, frontendUrl }) {
  const safeTip = typeof tip === 'string' && tip.length > 10
    ? tip
    : 'Pick the one answer that felt weakest and rerun it out loud until it lands in under two minutes.';
  const subject = 'One thing to fix from your mock interview';
  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 540px; margin: 0 auto; color: #1F2937;">
    <h2 style="color: #1F2937;">Hi ${escapeHtml(userName)},</h2>
    <p>You ran your free voice mock interview a couple of days ago. From your session, here is the one improvement worth practicing first:</p>
    <div style="background: #F9FAFB; border-left: 4px solid #D97706; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
      <p style="margin: 0; color: #374151;">${escapeHtml(safeTip)}</p>
    </div>
    <p>Try that answer out loud once more. When you are ready for another interview, subscriptions include up to 60 sessions per UTC calendar month. The one-time Interview Pack includes five sessions valid for 90 days. See the available plans below.</p>
    <p style="margin: 24px 0;">
      <a href="${frontendUrl}/pricing" style="background: #007A30; color: #FFFFFF; font-weight: 700; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Keep practicing</a>
    </p>
    <p style="color: #6B7280; font-size: 13px;">This is the only reminder we will send about your session. Good luck out there.</p>
    <p style="color: #6B7280; font-size: 13px;">JobHackAI</p>
  </div>`;
  return { subject, html };
}

async function sendEmail(env, { to, subject, html, operationId }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `voice-followup/${operationId}`
    },
    body: JSON.stringify({
      from: 'JobHackAI <noreply@jobhackai.io>',
      to: [to],
      subject,
      html
    })
  });
  if (!res.ok) {
    await res.body?.cancel();
    // Only definitive request rejection permits another attempt. Timeouts,
    // conflict/rate-limit and server responses need provider reconciliation.
    return [400, 401, 403, 404, 405, 406, 413, 415, 422].includes(res.status) ? 'rejected' : 'uncertain';
  }
  const receipt = await res.json();
  return typeof receipt?.id === 'string' && receipt.id.length > 0 ? 'accepted' : 'uncertain';
}

async function sweepStaleSessions(db) {
  const res = await db.prepare(
    `UPDATE voice_sessions SET status = 'abandoned', updated_at = datetime('now')
     WHERE status IN ('created', 'active')
       AND started_at < datetime('now', '-60 minutes')
       AND EXISTS (SELECT 1 FROM users u WHERE u.id=voice_sessions.user_id
         AND NOT EXISTS (SELECT 1 FROM account_deletion_admissions d WHERE d.auth_id=u.auth_id)
         AND NOT EXISTS (SELECT 1 FROM deleted_auth_ids d WHERE d.auth_id=u.auth_id))`
  ).run();
  const swept = res?.meta?.changes ?? 0;
  if (swept > 0) console.log(`[VOICE-FOLLOWUP] Marked ${swept} stale session(s) abandoned`);
}

export async function sendFollowups(env, db = env.JOBHACKAI_DB) {
  if (!env.RESEND_API_KEY || !frontend(env)) return;
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
       AND NOT EXISTS (SELECT 1 FROM account_deletion_admissions d WHERE d.auth_id=u.auth_id)
       AND NOT EXISTS (SELECT 1 FROM deleted_auth_ids d WHERE d.auth_id=u.auth_id)
       AND vs.ended_at < datetime('now', '-${FOLLOWUP_DELAY_HOURS} hours')
     LIMIT ${BATCH_LIMIT}`
  ).all();

  const candidates = rows?.results || [];
  if (candidates.length === 0) return;

  console.log(`[VOICE-FOLLOWUP] ${candidates.length} candidate(s) for the 48h email`);

  for (const row of candidates) {
    let operation = null;
    try {
      operation = await admitAccountOperation(env, row.auth_id,'account',{purpose:'followup'});
      // Recheck eligibility under admission: the candidate snapshot may have
      // become stale. A later deletion intent waits for this full operation.
      const claim = await db.prepare(
        `UPDATE users SET voice_followup_email_sent_at = datetime('now')
         WHERE id = ? AND auth_id = ? AND email = ?
           AND voice_followup_email_sent_at IS NULL AND free_session_used = 1
           AND plan = 'free' AND COALESCE(voice_sessions_remaining,0) = 0
           AND COALESCE(has_ever_paid,0) = 0
           AND NOT EXISTS (SELECT 1 FROM deleted_auth_ids d WHERE d.auth_id=users.auth_id)`
      ).bind(row.id, row.auth_id, row.email).run();
      if ((claim?.meta?.changes ?? 0) !== 1) {
        await settleAccountOperation(env, operation, 'finished');
        operation = null;
        continue;
      }

      let tip = null;
      try { tip = JSON.parse(row.scorecard_json || '{}').topImprovement || null; } catch (_) {}

      const userName = String(row.email).split('@')[0];
      const { subject, html } = followupEmail({
        userName,
        tip,
        frontendUrl: frontend(env)
      });
      const outcome = await sendEmail(env, { to: row.email, subject, html, operationId: operation.id });
      if (outcome === 'rejected') {
        // A definitive rejection can be retried. Never release on an
        // ambiguous response: provider idempotency only lasts 24 hours.
        await db.prepare(
          `UPDATE users SET voice_followup_email_sent_at = NULL WHERE id = ? AND auth_id = ?`
        ).bind(row.id, row.auth_id).run();
      }
      await settleAccountOperation(env, operation, outcome === 'uncertain' ? 'uncertain' : 'finished');
      operation = null;
      console.log(`[VOICE-FOLLOWUP] ${outcome}`);
    } catch (err) {
      if (operation) {
        try { await settleAccountOperation(env, operation, 'uncertain'); } catch (_) { /* Retain active claim for reconciliation. */ }
      }
      // Neither recipient details nor provider responses belong in logs.
      console.warn(`[VOICE-FOLLOWUP] ${err?.message === 'account_deletion_pending' ? 'deletion_pending' : err?.message === 'account_operation_busy' ? 'account_busy' : err?.message === 'account_operation_suppressed' ? 'notification_suppressed' : 'reconciliation_required'}`);
    }
  }
}

export default {
  async scheduled(event, env, ctx) {
    if (isDevCutoverPaused(env)) return;
    const db = env.JOBHACKAI_DB;
    if (!db) {
      console.error('[VOICE-FOLLOWUP] No D1 binding');
      return;
    }

    try {
      await sweepStaleSessions(db);
    } catch (err) {
      // Pre-migration-020 environments: table does not exist yet
      console.warn('[VOICE-FOLLOWUP] Sweep failed; schema/configuration check required');
      return;
    }

    if (!enabled(env)) {
      console.log('[VOICE-FOLLOWUP] VOICE_INTERVIEW_ENABLED is off; no emails');
      return;
    }

    try {
      await sendFollowups(env, db);
    } catch (err) {
      console.error('[VOICE-FOLLOWUP] Follow-up pass failed; schema/configuration check required');
    }
  }
};
