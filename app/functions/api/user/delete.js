import { getBearer, verifyFirebaseIdToken, deleteFirebaseAuthUserAdmin } from '../../_lib/firebase-auth.js';
import { getDb, writeDeletedTombstone } from '../../_lib/db.js';
import { invalidateBillingCaches } from '../../_lib/billing-utils.js';
import { cancelBillingBeforeDeletion } from '../../_lib/account-deletion-billing.js';
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
    // Look up user — may be null if D1 and Firebase are out of sync
    const user = await db.prepare(
      'SELECT id, auth_id, email, stripe_customer_id FROM users WHERE auth_id = ?'
    ).bind(uid).first();

    const userId = user?.id || null;
    const userEmail = user?.email || email;

    // Confirm billing cancellation while the user can still sign in and retry.
    // A partial cancellation is possible if a later Stripe call fails; never
    // claim that nothing changed in that case, and never remove sign-in access.
    try {
      await cancelBillingBeforeDeletion(env, { uid, user, email });
    } catch (billingError) {
      console.error('[DELETE-USER] Billing preflight failed:', billingError.message);
      return new Response(JSON.stringify({
        ok: false,
        error: 'We could not verify that all subscriptions were canceled. Your account remains available. Some subscriptions may already be canceled; check billing before retrying, or contact privacy@jobhackai.io.'
      }), { status: 503, headers: corsHeaders(origin, env) });
    }

    // Billing is settled before attempting Firebase identity removal.
    // Existing post-identity cleanup remains best effort (see review notes).
    let firebaseAuthDeleted = false;

    // Approach A: Firebase Admin API via service account (preferred)
    const saJson = (env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    if (saJson) {
      const fbResult = await deleteFirebaseAuthUserAdmin(saJson, uid);
      if (fbResult.ok) {
        firebaseAuthDeleted = true;
        console.log(`[DELETE-USER] Firebase Auth user ${fbResult.alreadyDeleted ? 'already deleted' : 'deleted'} (admin API):`, uid);
      } else {
        errors.push(`Firebase Admin API deletion failed: ${fbResult.error}`);
        console.error('[DELETE-USER] Firebase Admin API deletion failed:', fbResult.error);
      }
    }

    // Approach B: Client-side Identity Toolkit API (fallback)
    if (!firebaseAuthDeleted) {
      const firebaseApiKey = (env.FIREBASE_WEB_API_KEY || '').trim();
      if (firebaseApiKey && token) {
        try {
          const fbRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(firebaseApiKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken: token })
            }
          );
          if (fbRes.ok) {
            firebaseAuthDeleted = true;
            console.log('[DELETE-USER] Firebase Auth user deleted (client API):', uid);
          } else {
            const fbErr = await fbRes.text().catch(() => '');
            errors.push(`Firebase client API deletion failed (${fbRes.status}): ${fbErr}`);
            console.error('[DELETE-USER] Firebase client API deletion failed:', fbRes.status, fbErr);
          }
        } catch (fbDelErr) {
          errors.push(`Firebase client API deletion error: ${fbDelErr.message}`);
          console.error('[DELETE-USER] Firebase client API deletion error:', fbDelErr.message);
        }
      } else if (!saJson) {
        errors.push('Firebase Auth deletion skipped: neither FIREBASE_SERVICE_ACCOUNT_JSON nor FIREBASE_WEB_API_KEY configured');
        console.warn('[DELETE-USER] No Firebase credentials configured, skipping Firebase Auth deletion');
      }
    }

    if (!firebaseAuthDeleted) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Your sign-in account could not be deleted. Subscription cancellation has completed; your stored account data remains available. You can retry deletion or contact privacy@jobhackai.io.',
        partialErrors: errors
      }), { status: 500, headers: corsHeaders(origin, env) });
    }

    // --- Point of no return: Firebase identity is gone. ---
    // From this point, the user can no longer authenticate, so self-service
    // retry is impossible. All remaining steps are best-effort cleanup;
    // failures are collected as warnings but we always return 200 because
    // the account deletion (auth removal) has already succeeded.

    // 3. Get resume sessions for KV cleanup before deleting
    let resumeSessions = [];
    if (userId) {
      try {
        resumeSessions = await db.prepare(
          'SELECT id, raw_text_location FROM resume_sessions WHERE user_id = ?'
        ).bind(userId).all().then(r => r.results || []);
      } catch (e) {
        errors.push(`Failed to fetch resume sessions: ${e.message}`);
      }
    }

    // 4. Delete from all related D1 tables (order matters for foreign keys)
    //    Tables keyed by auth_id (uid) are always cleaned; tables keyed by
    //    integer userId are skipped when no D1 row existed (nothing to delete).
    const deletions = [
      // Tables using auth_id (TEXT) directly as user_id — always safe
      { table: 'linkedin_runs', sql: "DELETE FROM linkedin_runs WHERE user_id = ?", bind: uid },
      { table: 'role_usage_log', sql: "DELETE FROM role_usage_log WHERE user_id = ?", bind: uid },
      { table: 'cover_letter_history', sql: "DELETE FROM cover_letter_history WHERE user_id = ?", bind: uid },
    ];
    if (userId) {
      deletions.push(
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
        { table: 'first_resume_snapshots', sql: "DELETE FROM first_resume_snapshots WHERE user_id = ?", bind: userId },
      );
    }

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

    // 5. Delete the user record itself (uses auth_id so it works even without userId)
    let userDeleted = false;
    try {
      const delResult = await db.prepare('DELETE FROM users WHERE auth_id = ?').bind(uid).run();
      const changes = delResult?.meta?.changes ?? delResult?.changes ?? 0;
      userDeleted = changes > 0;
      if (userDeleted) {
        console.log('[DELETE-USER] Deleted user record:', uid);
      } else {
        // No D1 row — not an error if the user only existed in Firebase
        console.log('[DELETE-USER] No user record in D1 for:', uid);
      }
    } catch (userDelErr) {
      errors.push(`Failed to delete user record: ${userDelErr.message}`);
      console.error('[DELETE-USER] Critical: user record deletion failed:', userDelErr.message);
    }

    // 7. Clean up KV keys
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
        // User-scoped data keys
        await env.JOBHACKAI_KV.delete(`user:${uid}:lastResume`);
        await env.JOBHACKAI_KV.delete(`atsUsage:${uid}:lifetime`);
        await env.JOBHACKAI_KV.delete(`usage:${uid}`);
        console.log('[DELETE-USER] KV cleanup complete');
      } catch (kvErr) {
        errors.push(`KV cleanup error: ${kvErr.message}`);
      }
    }

    if (!userDeleted && user) {
      // Only warn if a D1 row existed but couldn't be removed
      errors.push('User record cleanup needs support follow-up');
    }

    // Write tombstones so delayed Stripe webhooks don't recreate this user.
    // D1 is authoritative; KV is best-effort cache. If D1 tombstone fails,
    // delayed webhooks may recreate the account — surface as error for monitoring.
    const tombstoneWritten = await writeDeletedTombstone(env, uid, userEmail);
    if (!tombstoneWritten) {
      errors.push('Failed to write deletion tombstone to database — delayed Stripe webhooks may recreate this account');
      console.error('[DELETE-USER] Critical: D1 tombstone write failed for:', uid);
    }
    if (env.JOBHACKAI_KV) {
      try {
        await env.JOBHACKAI_KV.put(`deleted:${uid}`, '1', { expirationTtl: 7776000 });
      } catch (kvTombErr) {
        errors.push(`KV tombstone write failed: ${kvTombErr.message}`);
        console.warn('[DELETE-USER] KV tombstone write failed (D1 tombstone is authoritative):', kvTombErr?.message || kvTombErr);
      }
    }

    // Report the cleanup outcome only after KV and tombstone work finishes.
    if (userEmail) {
      try {
        const { subject, html } = accountDeletedEmail(userEmail, { cleanupPending: errors.length > 0 });
        const emailResult = await sendEmail(env, { to: userEmail, subject, html });
        if (!emailResult.ok) {
          errors.push(`Deletion email not delivered: ${emailResult.error || 'unknown'}`);
        }
      } catch (emailErr) {
        errors.push(`Failed to send deletion email: ${emailErr.message}`);
      }
    }

    // Always return 200 after Firebase Auth is deleted — the user can no
    // longer authenticate, so the deletion succeeded from their perspective.
    // Any cleanup failures are surfaced as warnings for server-side monitoring.
    return new Response(JSON.stringify({
      ok: true,
      message: errors.length ? 'Sign-in access removed; cleanup requires follow-up' : 'Account sign-in access removed',
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
