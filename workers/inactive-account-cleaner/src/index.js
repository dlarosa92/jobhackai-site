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

  // Guard: verify activity-tracking columns exist (added by migration 015).
  // Fresh databases created from an older schema.sql may lack them.
  const hasColumns = await checkActivityColumns(db);
  if (!hasColumns) {
    console.warn('[inactive-cleaner] Skipping: activity-tracking columns (last_login_at, last_activity_at, deletion_warning_sent_at) not present. Run migration 015.');
    return;
  }

  // Phase 1: Send warning emails to users at 23 months inactive
  await sendWarningEmails(db, env);

  // Phase 2: Delete users at 24+ months who were already warned
  await deleteInactiveUsers(db, env);

  // Phase 3: Purge expired tombstones (> 90 days) to prevent unbounded growth.
  // 90 days covers Stripe's retry window (72 h) with wide margin.
  await purgeExpiredTombstones(db);
}

async function checkActivityColumns(db) {
  try {
    // PRAGMA table_info returns column metadata; check for the columns we need
    const info = await db.prepare("PRAGMA table_info('users')").all();
    const columns = new Set((info.results || []).map(r => r.name));
    return columns.has('last_login_at') && columns.has('deletion_warning_sent_at') && columns.has('last_activity_at');
  } catch (err) {
    console.error('[inactive-cleaner] Failed to inspect users table:', err.message);
    return false;
  }
}

async function purgeExpiredTombstones(db) {
  try {
    const result = await db.prepare(
      "DELETE FROM deleted_auth_ids WHERE deleted_at < datetime('now', '-90 days')"
    ).run();
    const purged = result?.meta?.changes || 0;
    if (purged > 0) {
      console.log(`[inactive-cleaner] Purged ${purged} expired tombstones (> 90 days old)`);
    }
  } catch (err) {
    // Non-critical: table may not exist yet in older schemas
    console.warn('[inactive-cleaner] Tombstone purge error:', err.message);
  }
}

async function sendWarningEmails(db, env) {
  try {
    // Users inactive for 23+ months with no active subscription and no warning sent yet
    // Exclude legacy users (both activity fields NULL) until they have at least one activity recorded
    const warningUsers = await db.prepare(`
      SELECT id, auth_id, email, stripe_customer_id FROM users
      WHERE deletion_warning_sent_at IS NULL
        AND (plan IS NULL OR plan = 'free')
        AND (
          (last_login_at IS NOT NULL AND last_login_at < datetime('now', '-23 months')
           AND (last_activity_at IS NULL OR last_activity_at < datetime('now', '-23 months')))
          OR
          (last_login_at IS NULL AND last_activity_at IS NOT NULL
           AND last_activity_at < datetime('now', '-23 months'))
        )
      LIMIT 100
    `).all();

    const users = warningUsers.results || [];
    console.log(`[inactive-cleaner] Found ${users.length} users for 23-month warning`);

    for (const user of users) {
      try {
        // Verify against Stripe before warning — D1 plan state may be stale
        if (env.STRIPE_SECRET_KEY) {
          let stripeCustomerId = user.stripe_customer_id || null;
          if (!stripeCustomerId && user.email) {
            try {
              stripeCustomerId = await findStripeCustomerByEmail(env, user.email, user.auth_id);
            } catch (_) {}
          }
          if (stripeCustomerId) {
            try {
              const subCheck = await hasActiveStripeSubscriptions(env, stripeCustomerId);
              if (subCheck.hasActive) {
                const repairedPlan = planFromSubscription(env, subCheck.subscriptions) || 'essential';
                console.warn(`[inactive-cleaner] User ${user.auth_id} has active Stripe subscriptions — skipping warning and repairing D1 plan to '${repairedPlan}'`);
                try {
                  await db.prepare(
                    "UPDATE users SET plan = ? WHERE id = ?"
                  ).bind(repairedPlan, user.id).run();
                } catch (_) {}
                continue;
              }
            } catch (_) {
              // Can't verify Stripe — skip this user to be safe
              console.warn(`[inactive-cleaner] Stripe check failed for ${user.auth_id}, skipping warning`);
              continue;
            }
          }
        }

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
    // Exclude legacy users (both activity fields NULL) until they have at least one activity recorded
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

async function deleteFirebaseAuthUser(env, uid) {
  const saJson = (env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!saJson) {
    return { ok: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' };
  }

  let sa;
  try {
    sa = JSON.parse(saJson);
  } catch (e) {
    return { ok: false, error: `Invalid service account JSON: ${e.message}` };
  }

  // Build a JWT to exchange for a Google OAuth2 access token
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const projectId = sa.project_id;
  if (!projectId) {
    return { ok: false, error: 'Service account JSON missing project_id' };
  }

  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  let accessToken;
  try {
    // Import the RSA private key for signing
    const pemBody = sa.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s/g, '');
    const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8', keyBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );

    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', cryptoKey,
      new TextEncoder().encode(signingInput)
    );
    const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const jwt = `${signingInput}.${b64sig}`;

    // Exchange JWT for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      return { ok: false, error: `OAuth2 token exchange failed (${tokenRes.status}): ${errText}` };
    }
    const tokenData = await tokenRes.json();
    accessToken = tokenData.access_token;
  } catch (e) {
    return { ok: false, error: `Service account auth failed: ${e.message}` };
  }

  // Delete the Firebase Auth user using the Admin API (project-scoped endpoint).
  // The project-scoped URL is required when authenticating with a service
  // account Bearer token and specifying localId instead of idToken.
  try {
    const deleteRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:delete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ localId: uid, targetProjectId: projectId })
      }
    );
    if (!deleteRes.ok) {
      const errText = await deleteRes.text().catch(() => '');
      // Treat "user not found" as success — the user was already deleted
      // (e.g., prior run succeeded at Firebase but failed during D1 cleanup).
      // Firebase Identity Toolkit returns USER_NOT_FOUND for missing accounts.
      if (errText.includes('USER_NOT_FOUND')) {
        return { ok: true, alreadyDeleted: true };
      }
      return { ok: false, error: `Firebase Auth delete failed (${deleteRes.status}): ${errText}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Firebase Auth delete request failed: ${e.message}` };
  }
}

async function findStripeCustomerByEmail(env, email, uid) {
  const apiBase = 'https://api.stripe.com/v1';
  const headers = {
    'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`
  };

  const searchRes = await fetch(
    `${apiBase}/customers?email=${encodeURIComponent(email)}&limit=100`,
    { headers }
  );
  if (!searchRes.ok) return null;

  const searchData = await searchRes.json();
  const customers = (searchData?.data || []).filter(c => c && c.deleted !== true);
  if (customers.length === 0) return null;

  // Only return customer whose metadata matches this Firebase UID
  // If no match found, return null to avoid matching wrong customer
  const uidMatch = customers.find(c => c?.metadata?.firebaseUid === uid);
  if (uidMatch) return uidMatch.id;

  // No UID match found — return null to avoid returning wrong customer
  if (customers.length > 0) {
    console.warn(`[inactive-cleaner] Stripe email search found customers but none matched firebaseUid ${uid} — skipping to avoid matching wrong customer`);
  }
  return null;
}

async function hasActiveStripeSubscriptions(env, customerId) {
  const apiBase = 'https://api.stripe.com/v1';
  const headers = {
    'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`
  };

  const listRes = await fetch(
    `${apiBase}/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`,
    { headers }
  );
  if (!listRes.ok) {
    // Can't verify — throw so callers skip this user without repairing D1.
    // We must NOT return hasActive: true here because callers would repair
    // the plan to a paid tier without actual Stripe verification.
    throw new Error(`Stripe list subscriptions failed (${listRes.status})`);
  }

  const listData = await listRes.json();
  const activeSubs = (listData?.data || []).filter(s =>
    s && ['active', 'trialing', 'past_due'].includes(s.status)
  );

  return { hasActive: activeSubs.length > 0, subscriptions: activeSubs };
}

// Derive a valid plan name from Stripe subscription price IDs.
// Uses the same env-based price mapping as the Stripe webhook handler.
// Falls back to null so callers can default to 'essential' (lowest paid tier).
function planFromSubscription(env, subscriptions) {
  if (!subscriptions || subscriptions.length === 0) return null;

  const essential = env.STRIPE_PRICE_ESSENTIAL_MONTHLY || env.PRICE_ESSENTIAL_MONTHLY || env.STRIPE_PRICE_ESSENTIAL || env.PRICE_ESSENTIAL;
  const pro = env.STRIPE_PRICE_PRO_MONTHLY || env.PRICE_PRO_MONTHLY || env.STRIPE_PRICE_PRO || env.PRICE_PRO;
  const premium = env.STRIPE_PRICE_PREMIUM_MONTHLY || env.PRICE_PREMIUM_MONTHLY || env.STRIPE_PRICE_PREMIUM || env.PRICE_PREMIUM;

  // Check each active subscription's price ID against known plans.
  // Return the highest tier found (premium > pro > essential).
  const planRank = { essential: 1, pro: 2, premium: 3 };
  let best = null;
  for (const sub of subscriptions) {
    const priceId = sub?.items?.data?.[0]?.price?.id || sub?.plan?.id || '';
    let matched = null;
    if (priceId && priceId === premium) matched = 'premium';
    else if (priceId && priceId === pro) matched = 'pro';
    else if (priceId && priceId === essential) matched = 'essential';
    if (matched && (!best || planRank[matched] > planRank[best])) {
      best = matched;
    }
  }
  return best;
}

async function deleteUserData(db, env, user) {
  const userId = user.id;
  const uid = user.auth_id;

  // Verify against Stripe (source of truth) before deleting. The SQL query
  // filters on plan IS NULL OR plan = 'free', but D1 can be stale. If Stripe
  // shows active subscriptions the user is actually paying — fix D1 and skip.
  if (env.STRIPE_SECRET_KEY) {
    let stripeCustomerId = user.stripe_customer_id || null;

    // Fallback: if stripe_customer_id is missing/stale, search by email
    if (!stripeCustomerId && user.email) {
      try {
        stripeCustomerId = await findStripeCustomerByEmail(env, user.email, uid);
        if (stripeCustomerId) {
          console.log(`[inactive-cleaner] Found Stripe customer via email search: ${stripeCustomerId}`);
        }
      } catch (searchErr) {
        console.warn(`[inactive-cleaner] Stripe email search error for ${uid}:`, searchErr.message);
      }
    }

    if (stripeCustomerId) {
      // Check for active subscriptions BEFORE cancelling anything
      let subCheck;
      try {
        subCheck = await hasActiveStripeSubscriptions(env, stripeCustomerId);
      } catch (err) {
        // If we can't reach Stripe, err on the side of caution — don't delete
        throw new Error(`Stripe check failed for ${uid}, aborting deletion: ${err.message}`);
      }

      if (subCheck.hasActive) {
        // User has live Stripe subscriptions — D1 plan state was stale.
        // Repair D1 and abort deletion so a paying user is never removed.
        const repairedPlan = planFromSubscription(env, subCheck.subscriptions) || 'essential';
        console.warn(`[inactive-cleaner] User ${uid} has active Stripe subscriptions — skipping deletion and repairing D1 plan to '${repairedPlan}'`);
        try {
          await db.prepare(
            "UPDATE users SET plan = ?, deletion_warning_sent_at = NULL WHERE id = ?"
          ).bind(repairedPlan, userId).run();
        } catch (repairErr) {
          console.error(`[inactive-cleaner] D1 plan repair failed for ${uid}:`, repairErr.message);
        }
        throw new Error(`SKIP: user ${uid} has active Stripe subscriptions (stale D1 plan)`);
      }
    }
  }

  // Delete Firebase Auth identity FIRST so the user cannot re-authenticate.
  // If this fails, abort the entire deletion to avoid leaving an active
  // Firebase identity while app data is removed (the user could log in
  // and be re-provisioned after retention deletion).
  const fbResult = await deleteFirebaseAuthUser(env, uid);
  if (fbResult.ok) {
    console.log(`[inactive-cleaner] Firebase Auth user ${fbResult.alreadyDeleted ? 'already deleted' : 'deleted'}: ${uid}`);
  } else {
    throw new Error(`Firebase Auth deletion failed for ${uid}, aborting data deletion: ${fbResult.error}`);
  }

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
    { sql: "DELETE FROM first_resume_snapshots WHERE user_id = ?", bind: userId },
  ];

  for (const { sql, bind } of deletions) {
    try {
      await db.prepare(sql).bind(bind).run();
    } catch (_) {}
  }

  // Delete user record
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

  // Write tombstones so delayed Stripe webhooks don't recreate this user.
  // D1 is authoritative; KV is best-effort cache.
  try {
    await db.prepare(
      'INSERT OR REPLACE INTO deleted_auth_ids (auth_id, deleted_at) VALUES (?, datetime(\'now\'))'
    ).bind(uid).run();
  } catch (d1Err) {
    console.error('[inactive-cleaner] D1 tombstone write failed for', uid, ':', d1Err?.message || d1Err);
  }
  if (env.JOBHACKAI_KV) {
    try {
      await env.JOBHACKAI_KV.put(`deleted:${uid}`, '1', { expirationTtl: 7776000 });
    } catch (_) {}
  }

  // Send deletion confirmation email AFTER successful user record deletion
  if (user.email) {
    const { subject, html } = accountDeletedEmail(user.email);
    await sendEmail(env, { to: user.email, subject, html }).catch(() => {});
  }

  // KV cleanup
  if (!env.JOBHACKAI_KV) {
    console.warn('[inactive-cleaner] JOBHACKAI_KV not bound — skipping KV cleanup for user:', uid);
  } else {
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
    // User-scoped data keys
    await env.JOBHACKAI_KV.delete(`user:${uid}:lastResume`).catch(() => {});
    await env.JOBHACKAI_KV.delete(`atsUsage:${uid}:lifetime`).catch(() => {});
    await env.JOBHACKAI_KV.delete(`usage:${uid}`).catch(() => {});
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
          <p style="margin:0;font-size:12px;color:#9ca3af;">&copy; 2026 JobHackAI LLC &middot; <a href="mailto:privacy@jobhackai.io" style="color:#9ca3af;text-decoration:underline;">privacy@jobhackai.io</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inactivityWarningEmail(userName) {
  const name = escapeHtml(userName || 'there');
  return {
    subject: 'Your JobHackAI account will be deleted in 30 days',
    html: emailWrapper(`
      <h2 style="margin:0 0 16px;font-size:20px;color:#1F2937;">Your account will be deleted in 30 days</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
        Hi ${name}, we noticed you haven't used JobHackAI in nearly 24 months. Per our data retention policy, inactive accounts are automatically deleted after this period.
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
