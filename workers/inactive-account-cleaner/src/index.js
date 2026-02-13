// Inactive account cleaner
// Runs monthly (1st at 04:00 UTC) to enforce 24-month data retention policy.
// - At 23 months inactive: sends 30-day warning email
// - At 24+ months inactive (already warned): deletes account and all data

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runInactiveAccountCleanup(env));
  }
};

async function runInactiveAccountCleanup(env) {
  const db = env.JOBHACKAI_DB;
  if (!db || typeof db.prepare !== 'function') {
    console.warn('[inactive-cleaner] JOBHACKAI_DB not bound');
    return;
  }

  // Phase 1: Send warning emails to users at 23 months inactive
  await sendWarningEmails(db, env);

  // Phase 2: Delete users at 24+ months who were already warned
  await deleteInactiveUsers(db, env);
}

async function sendWarningEmails(db, env) {
  try {
    // Users inactive for 23+ months with no active subscription and no warning sent yet
    const warningUsers = await db.prepare(`
      SELECT id, auth_id, email FROM users
      WHERE deletion_warning_sent_at IS NULL
        AND (plan IS NULL OR plan = 'free')
        AND (
          (last_login_at IS NOT NULL AND last_login_at < datetime('now', '-23 months')
           AND (last_activity_at IS NULL OR last_activity_at < datetime('now', '-23 months')))
          OR
          (last_login_at IS NULL AND last_activity_at IS NOT NULL
           AND last_activity_at < datetime('now', '-23 months'))
          OR
          (last_login_at IS NULL AND last_activity_at IS NULL
           AND created_at < datetime('now', '-23 months'))
        )
      LIMIT 100
    `).all();

    const users = warningUsers.results || [];
    console.log(`[inactive-cleaner] Found ${users.length} users for 23-month warning`);

    for (const user of users) {
      try {
        if (user.email) {
          const userName = user.email.split('@')[0];
          const { subject, html } = inactivityWarningEmail(userName);
          const emailResult = await sendEmail(env, { to: user.email, subject, html });

          if (emailResult.ok) {
            await db.prepare(
              'UPDATE users SET deletion_warning_sent_at = datetime(\'now\') WHERE id = ?'
            ).bind(user.id).run();
            console.log(`[inactive-cleaner] Warning sent to ${user.email}`);
          } else {
            console.warn(`[inactive-cleaner] Warning email failed for user ${user.id}, skipping flag`);
          }
        } else {
          // No email on file — flag for deletion directly (can't send warning)
          await db.prepare(
            'UPDATE users SET deletion_warning_sent_at = datetime(\'now\') WHERE id = ?'
          ).bind(user.id).run();
          console.log(`[inactive-cleaner] No email for user ${user.id}, flagged for deletion without warning`);
        }
      } catch (err) {
        console.warn(`[inactive-cleaner] Failed to process warning for user ${user.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[inactive-cleaner] Warning phase error:', err.message);
  }
}

async function deleteInactiveUsers(db, env) {
  try {
    // Users inactive for 24+ months who were already warned at least 30 days ago
    const deletionUsers = await db.prepare(`
      SELECT id, auth_id, email, stripe_customer_id FROM users
      WHERE deletion_warning_sent_at IS NOT NULL
        AND deletion_warning_sent_at < datetime('now', '-30 days')
        AND (plan IS NULL OR plan = 'free')
        AND (
          (last_login_at IS NOT NULL AND last_login_at < datetime('now', '-24 months')
           AND (last_activity_at IS NULL OR last_activity_at < datetime('now', '-24 months')))
          OR
          (last_login_at IS NULL AND last_activity_at IS NOT NULL
           AND last_activity_at < datetime('now', '-24 months'))
          OR
          (last_login_at IS NULL AND last_activity_at IS NULL
           AND created_at < datetime('now', '-24 months'))
        )
      LIMIT 50
    `).all();

    const users = deletionUsers.results || [];
    console.log(`[inactive-cleaner] Found ${users.length} users for deletion`);

    for (const user of users) {
      try {
        await deleteUserData(db, env, user);
        console.log(`[inactive-cleaner] Deleted user ${user.auth_id}`);
      } catch (delErr) {
        console.error(`[inactive-cleaner] Failed to delete user ${user.auth_id}:`, delErr.message);
      }
    }
  } catch (err) {
    console.error('[inactive-cleaner] Deletion phase error:', err.message);
  }
}

async function deleteUserData(db, env, user) {
  const userId = user.id;
  const uid = user.auth_id;

  // Get resume sessions for KV cleanup before deleting
  let resumeSessions = [];
  try {
    const res = await db.prepare(
      'SELECT id, raw_text_location FROM resume_sessions WHERE user_id = ?'
    ).bind(userId).all();
    resumeSessions = res.results || [];
  } catch (_) {}

  // Delete from all related tables (same order as /api/user/delete)
  const deletions = [
    { sql: "DELETE FROM linkedin_runs WHERE user_id = ?", bind: uid },
    { sql: "DELETE FROM role_usage_log WHERE user_id = ?", bind: uid },
    { sql: "DELETE FROM cover_letter_history WHERE user_id = ?", bind: uid },
    { sql: "DELETE FROM feature_daily_usage WHERE user_id = ?", bind: userId },
    { sql: "DELETE FROM cookie_consents WHERE user_id = ?", bind: userId },
    { sql: "DELETE FROM feedback_sessions WHERE resume_session_id IN (SELECT id FROM resume_sessions WHERE user_id = ?)", bind: userId },
    { sql: "DELETE FROM resume_sessions WHERE user_id = ?", bind: userId },
    { sql: "DELETE FROM usage_events WHERE user_id = ?", bind: userId },
    { sql: "DELETE FROM interview_question_sets WHERE user_id = ?", bind: userId },
    { sql: "DELETE FROM mock_interview_sessions WHERE user_id = ?", bind: userId },
    { sql: "DELETE FROM mock_interview_usage WHERE user_id = ?", bind: userId },
    { sql: "DELETE FROM plan_change_history WHERE user_id = ?", bind: userId },
  ];

  for (const { sql, bind } of deletions) {
    try {
      await db.prepare(sql).bind(bind).run();
    } catch (_) {}
  }

  // Delete user record
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

  // Send deletion confirmation email AFTER successful user record deletion
  if (user.email) {
    const { subject, html } = accountDeletedEmail(user.email);
    await sendEmail(env, { to: user.email, subject, html }).catch(() => {});
  }

  // KV cleanup
  if (env.JOBHACKAI_KV) {
    for (const session of resumeSessions) {
      if (session.raw_text_location) {
        await env.JOBHACKAI_KV.delete(session.raw_text_location).catch(() => {});
      }
      await env.JOBHACKAI_KV.delete(`resume:${session.id}`).catch(() => {});
    }
    // Clean up all billing and customer cache keys
    await env.JOBHACKAI_KV.delete(`cusByUid:${uid}`).catch(() => {});
    await env.JOBHACKAI_KV.delete(`planByUid:${uid}`).catch(() => {});
    await env.JOBHACKAI_KV.delete(`billingStatus:${uid}`).catch(() => {});
    await env.JOBHACKAI_KV.delete(`trialUsedByUid:${uid}`).catch(() => {});
    await env.JOBHACKAI_KV.delete(`trialEndByUid:${uid}`).catch(() => {});
  }
}

// Inline email helpers (worker runs standalone, can't import from app/functions/_lib/)

async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.warn('[inactive-cleaner] RESEND_API_KEY not configured');
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
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
      const errText = await res.text().catch(() => '');
      console.error('[inactive-cleaner] Resend error:', res.status, errText);
      return { ok: false, error: `Resend returned ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function emailWrapper(bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb;">
          <span style="font-size:18px;font-weight:700;color:#1F2937;letter-spacing:0.5px;">JOBHACKAI</span>
        </td></tr>
        <tr><td style="padding:32px;">${bodyContent}</td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">&copy; 2025 JobHackAI LLC &middot; <a href="mailto:privacy@jobhackai.io" style="color:#9ca3af;text-decoration:underline;">privacy@jobhackai.io</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function inactivityWarningEmail(userName) {
  const name = userName || 'there';
  return {
    subject: 'Your JobHackAI account will be deleted in 30 days',
    html: emailWrapper(`
      <h2 style="margin:0 0 16px;font-size:20px;color:#1F2937;">Your account will be deleted in 30 days</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
        Hi ${name}, we noticed you haven't used JobHackAI in over 24 months. Per our data retention policy, inactive accounts are automatically deleted after this period.
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
        If you'd like to keep your account, simply log in within the next 30 days.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
        <tr><td style="background-color:#1976D2;border-radius:6px;">
          <a href="https://app.jobhackai.io/login.html" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Log In to Keep My Account</a>
        </td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.5;">
        <a href="https://app.jobhackai.io/privacy.html" style="color:#9ca3af;text-decoration:underline;">View our privacy policy</a>
      </p>
    `)
  };
}

function accountDeletedEmail(userEmail) {
  return {
    subject: 'Your JobHackAI account has been deleted',
    html: emailWrapper(`
      <h2 style="margin:0 0 16px;font-size:20px;color:#1F2937;">Your account has been deleted</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
        Your JobHackAI account and all associated data have been permanently removed due to inactivity. This includes your personal information and tool history.
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
        If you'd like to use JobHackAI again, you can create a new account at any time.
      </p>
      <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
        Questions? Contact us at <a href="mailto:privacy@jobhackai.io" style="color:#1976D2;text-decoration:underline;">privacy@jobhackai.io</a>.
      </p>
    `)
  };
}
