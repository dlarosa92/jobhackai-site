import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { getDb } from '../../_lib/db.js';
import { stripe, listSubscriptions, invalidateBillingCaches } from '../../_lib/billing-utils.js';
import { sendEmail } from '../../_lib/email.js';
import { accountDeletedEmail } from '../../_lib/email-templates.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: corsHeaders(origin, env)
    });
  }

  const token = getBearer(request);
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders(origin, env)
    });
  }

  let uid, email;
  try {
    const verified = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    uid = verified.uid;
    email = verified.payload?.email || null;
  } catch (authErr) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401, headers: corsHeaders(origin, env)
    });
  }

  const db = getDb(env);
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500, headers: corsHeaders(origin, env)
    });
  }

  const errors = [];

  try {
    // Look up user
    const user = await db.prepare(
      'SELECT id, auth_id, email, stripe_customer_id FROM users WHERE auth_id = ?'
    ).bind(uid).first();

    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404, headers: corsHeaders(origin, env)
      });
    }

    const userId = user.id;
    const userEmail = user.email || email;
    const customerId = user.stripe_customer_id;

    // 1. Cancel Stripe subscription if active (best-effort)
    if (customerId) {
      try {
        const subs = await listSubscriptions(env, customerId);
        const activeSubs = subs.filter(s =>
          s && ['active', 'trialing', 'past_due'].includes(s.status)
        );
        for (const sub of activeSubs) {
          try {
            await stripe(env, `/subscriptions/${sub.id}`, { method: 'DELETE' });
            console.log('[DELETE-USER] Cancelled subscription:', sub.id);
          } catch (subErr) {
            errors.push(`Failed to cancel subscription ${sub.id}: ${subErr.message}`);
          }
        }
      } catch (stripeErr) {
        errors.push(`Stripe cleanup error: ${stripeErr.message}`);
      }
    }

    // 2. Get resume sessions for KV cleanup before deleting
    let resumeSessions = [];
    try {
      resumeSessions = await db.prepare(
        'SELECT id, raw_text_location FROM resume_sessions WHERE user_id = ?'
      ).bind(userId).all().then(r => r.results || []);
    } catch (e) {
      errors.push(`Failed to fetch resume sessions: ${e.message}`);
    }

    // 3. Delete from all related D1 tables (order matters for foreign keys)
    const deletions = [
      // Tables using auth_id (TEXT) directly as user_id
      { table: 'linkedin_runs', sql: "DELETE FROM linkedin_runs WHERE user_id = ?", bind: uid },
      { table: 'role_usage_log', sql: "DELETE FROM role_usage_log WHERE user_id = ?", bind: uid },
      { table: 'cover_letter_history', sql: "DELETE FROM cover_letter_history WHERE user_id = ?", bind: uid },
      { table: 'feature_daily_usage', sql: "DELETE FROM feature_daily_usage WHERE user_id = ?", bind: userId },
      { table: 'cookie_consents', sql: "DELETE FROM cookie_consents WHERE user_id = ?", bind: userId },
      // feedback_sessions must be deleted before resume_sessions (FK)
      {
        table: 'feedback_sessions',
        sql: "DELETE FROM feedback_sessions WHERE resume_session_id IN (SELECT id FROM resume_sessions WHERE user_id = ?)",
        bind: userId
      },
      { table: 'resume_sessions', sql: "DELETE FROM resume_sessions WHERE user_id = ?", bind: userId },
      { table: 'usage_events', sql: "DELETE FROM usage_events WHERE user_id = ?", bind: userId },
      { table: 'interview_question_sets', sql: "DELETE FROM interview_question_sets WHERE user_id = ?", bind: userId },
      { table: 'mock_interview_sessions', sql: "DELETE FROM mock_interview_sessions WHERE user_id = ?", bind: userId },
      { table: 'mock_interview_usage', sql: "DELETE FROM mock_interview_usage WHERE user_id = ?", bind: userId },
      { table: 'plan_change_history', sql: "DELETE FROM plan_change_history WHERE user_id = ?", bind: userId },
    ];

    for (const { table, sql, bind } of deletions) {
      try {
        const res = await db.prepare(sql).bind(bind).run();
        const changes = res?.meta?.changes ?? res?.changes ?? 0;
        console.log(`[DELETE-USER] Deleted ${changes} rows from ${table}`);
      } catch (delErr) {
        errors.push(`Failed to delete from ${table}: ${delErr.message}`);
        console.error(`[DELETE-USER] Error deleting from ${table}:`, delErr.message);
      }
    }

    // 4. Send account deletion email BEFORE deleting user record
    if (userEmail) {
      try {
        const { subject, html } = accountDeletedEmail(userEmail);
        await sendEmail(env, { to: userEmail, subject, html });
      } catch (emailErr) {
        errors.push(`Failed to send deletion email: ${emailErr.message}`);
      }
    }

    // 5. Delete the user record itself — this MUST succeed for deletion to be considered complete
    let userDeleted = false;
    try {
      const delResult = await db.prepare('DELETE FROM users WHERE auth_id = ?').bind(uid).run();
      const changes = delResult?.meta?.changes ?? delResult?.changes ?? 0;
      userDeleted = changes > 0;
      if (userDeleted) {
        console.log('[DELETE-USER] Deleted user record:', uid);
      } else {
        console.error('[DELETE-USER] User record not found or already deleted:', uid);
      }
    } catch (userDelErr) {
      errors.push(`Failed to delete user record: ${userDelErr.message}`);
      console.error('[DELETE-USER] Critical: user record deletion failed:', userDelErr.message);
    }

    // 6. Clean up KV keys
    if (env.JOBHACKAI_KV) {
      try {
        // Resume session KV keys
        for (const session of resumeSessions) {
          if (session.raw_text_location) {
            await env.JOBHACKAI_KV.delete(session.raw_text_location);
          }
          await env.JOBHACKAI_KV.delete(`resume:${session.id}`);
        }
        // Customer ID cache
        await env.JOBHACKAI_KV.delete(`cusByUid:${uid}`);
        // Billing caches
        await invalidateBillingCaches(env, uid);
        console.log('[DELETE-USER] KV cleanup complete');
      } catch (kvErr) {
        errors.push(`KV cleanup error: ${kvErr.message}`);
      }
    }

    if (!userDeleted) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Failed to delete user record',
        partialErrors: errors
      }), { status: 500, headers: corsHeaders(origin, env) });
    }

    return new Response(JSON.stringify({
      ok: true,
      message: 'Account deleted successfully',
      ...(errors.length > 0 ? { warnings: errors } : {})
    }), { status: 200, headers: corsHeaders(origin, env) });

  } catch (error) {
    console.error('[DELETE-USER] Fatal error:', error);
    return new Response(JSON.stringify({
      error: 'Account deletion failed',
      details: error.message,
      partialErrors: errors
    }), { status: 500, headers: corsHeaders(origin, env) });
  }
}

function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io'];
  const configured = env?.FRONTEND_URL || null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || 'https://dev.jobhackai.io');
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin'
  };
}
