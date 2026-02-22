import { updateUserPlan, getUserPlanData, resetFeatureDailyUsage, resetUsageEvents, getDb, getOrCreateUserByAuthId, isDeletedUser } from '../_lib/db.js';
import { stripe, pickBestSubscription } from '../_lib/billing-utils.js';
import { sendEmail } from '../_lib/email.js';
import { subscriptionCancelledEmail } from '../_lib/email-templates.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = env.FRONTEND_URL || 'https://dev.jobhackai.io';
  
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });

  // Read raw body for signature verification
  const raw = await request.text();
  const valid = await verifyStripeWebhook(env, request, raw);
  if (!valid) return new Response('Invalid signature', { status: 401, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });

  const event = JSON.parse(raw);

  // Event de-duplication (24h) AFTER verification
  try {
    if (event && event.id) {
      const seenKey = `evt:${event.id}`;
      const seen = await env.JOBHACKAI_KV?.get(seenKey);
      if (seen) {
        return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });
      }
      await env.JOBHACKAI_KV?.put(seenKey, '1', { expirationTtl: 86400 });
    }
  } catch (_) { /* no-op */ }

  // Processing lock for shared KV (prevents Dev + QA double-processing)
  const lockKey = `processing:${event.id}`;
  try {
    const alreadyProcessing = await env.JOBHACKAI_KV?.get(lockKey);
    if (alreadyProcessing) {
      console.log(`⏭️ Event ${event.id} already being processed by another environment`);
      return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });
    }
    await env.JOBHACKAI_KV?.put(lockKey, '1', { expirationTtl: 60 }); // 60s lock
  } catch (_) { /* ignore lock failures */ }

  // Helper to update plan in D1 (source of truth) with timestamp-based ordering protection
  // Prevents out-of-order webhooks from overwriting newer states with older data
  const updatePlanInD1 = async (uid, planData, eventTimestampSeconds) => {
    if (!uid) return;
    try {
      // Get current plan_updated_at timestamp for ordering check
      if (eventTimestampSeconds !== undefined && Number.isFinite(eventTimestampSeconds)) {
        const currentPlanData = await getUserPlanData(env, uid);
        
        if (currentPlanData && currentPlanData.planUpdatedAt) {
          // Convert stored ISO 8601 datetime to Unix timestamp for comparison
          const storedTimestamp = Math.floor(new Date(currentPlanData.planUpdatedAt).getTime() / 1000);
          const eventTimestamp = Math.floor(Number(eventTimestampSeconds));

          if (eventTimestamp < storedTimestamp) {
            console.log(`⏭️ [WEBHOOK] Skipping out-of-order event: event.created=${eventTimestamp} < stored=${storedTimestamp} for uid=${uid}`);
            return; // Skip update - this event is older than what we already have
          }
        }
      }

      // Convert event timestamp to ISO 8601 string for storage (if provided)
      if (eventTimestampSeconds !== undefined && Number.isFinite(eventTimestampSeconds)) {
        planData.planEventTimestamp = new Date(eventTimestampSeconds * 1000).toISOString();
      } else {
        // No event timestamp provided - use current time (fallback for non-webhook updates)
        planData.planEventTimestamp = undefined;
      }

      // Write to D1 (source of truth)
      const success = await updateUserPlan(env, uid, planData);
      
      if (!success) {
        console.error(`❌ [WEBHOOK] D1 write failed for uid=${uid}`);
        throw new Error(`Failed to update plan in D1 for uid=${uid}`);
      }
      
      // Invalidate KV keys for all plan/usage as soon as D1 is updated (cache only)
      if (env.JOBHACKAI_KV) {
        try {
          await env.JOBHACKAI_KV.delete(kvPlanKey(uid));
          await env.JOBHACKAI_KV.delete(`trialUsedByUid:${uid}`);
          await env.JOBHACKAI_KV.delete(`trialEndByUid:${uid}`);
          await env.JOBHACKAI_KV.delete(`billingStatus:${uid}`);
          // Delete all monthly feedbackUsage keys for this UID
          const monthsToDelete = [];
          const today = new Date();
          for (let i = 0; i < 14; i++) { // Cover at least 12 months back + 2 future months safety
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthsToDelete.push(`feedbackUsage:${uid}:${monthKey}`);
          }
          for (const key of monthsToDelete) {
            await env.JOBHACKAI_KV.delete(key);
          }
          await env.JOBHACKAI_KV.delete(`atsUsage:${uid}:lifetime`);
        } catch (kvErr) {
          console.warn('[WEBHOOK] KV cache invalidation error:', kvErr);
        }
      }
    } catch (error) {
      console.error('[WEBHOOK] Error updating plan in D1:', error);
      throw error;
    }
  };

  // Resolve uid (and email) from customer metadata when possible
  const fetchCustomerInfo = async (customerId) => {
    if (!customerId) return { uid: null, email: null };
    const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    const c = await res.json();
    return { uid: c?.metadata?.firebaseUid || null, email: c?.email || null };
  };
  // Backward-compat helper used by event handlers
  const fetchUidFromCustomer = async (customerId) => {
    const { uid } = await fetchCustomerInfo(customerId);
    return uid;
  };

  try {
    if (event.type === 'checkout.session.completed') {
      console.log('🎯 WEBHOOK: checkout.session.completed received');
      const sessionId = event.data?.object?.id;
      const sessionMetadata = event.data?.object?.metadata || {};
      const originalPlan = sessionMetadata.plan;
      
      // Expand line items to reliably get price id
      const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items.data.price`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
      const sess = await r.json();
      const priceId = sess?.line_items?.data?.[0]?.price?.id || '';
      const customerId = sess?.customer || event.data?.object?.customer || null;
      const { uid, email: customerEmail } = await fetchCustomerInfo(customerId);
      
      // Determine effective plan based on original plan and subscription status
      let effectivePlan = 'free';
      if (originalPlan === 'trial') {
        effectivePlan = 'trial'; // Show as trial immediately
        // Trial usage will be tracked in D1 (source of truth). Do not write authoritative KV flags.
        console.log(`✅ TRIAL STARTED (tracked in D1): ${uid}`);
      } else {
        effectivePlan = priceToPlan(env, priceId) || 'essential';
      }
      
      console.log(`📝 CHECKOUT DATA: originalPlan=${originalPlan}, priceId=${priceId}, effectivePlan=${effectivePlan}, customerId=${customerId}, uid=${uid}`);
      if (effectivePlan && uid) {
        // Ensure user row exists in D1. First-time subscribers may not have a row yet
        // (checkout.session.completed is the first webhook after payment).
        // However, skip if a tombstone exists — the account was intentionally deleted.
        const db = getDb(env);
        const existingUser = db ? await db.prepare('SELECT id FROM users WHERE auth_id = ?').bind(uid).first() : null;
        if (!existingUser) {
          // Check D1 tombstone first (authoritative); KV as fallback when D1 unavailable
          const d1Tombstone = await isDeletedUser(env, uid);
          const kvTombstone = await env.JOBHACKAI_KV?.get(`deleted:${uid}`);
          if (d1Tombstone || kvTombstone) {
            console.log(`⏭️ [WEBHOOK] Skipping checkout plan update: user ${uid} was deleted (tombstone found)`);
            return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });
          }
          try {
            await getOrCreateUserByAuthId(env, uid, customerEmail, { updateActivity: false });
            console.log(`✅ [WEBHOOK] Created missing user row for first-time subscriber: ${uid}`);
          } catch (createErr) {
            console.error(`❌ [WEBHOOK] Failed to create user row for ${uid}:`, createErr?.message || createErr);
            return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });
          }
        }
        // Get subscription details if available
        const subscriptionId = sess?.subscription || null;
        let subscription = null;
        if (subscriptionId) {
          try {
            const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
              headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
            });
            subscription = await subRes.json();
          } catch (e) {
            console.warn('[WEBHOOK] Failed to fetch subscription details:', e);
          }
        }
        
        // Determine trial end date. Prefer subscription.trial_end if available.
        let trialEndsAtISO = subscription?.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;

        // If this was a trial and we couldn't fetch subscription details (or trial_end is missing),
        // set a conservative fallback so the user is marked as having used a trial and cannot re-use it.
        // The checkout session uses a 3-day trial (see checkout flow), so use 3 days as fallback.
        if (effectivePlan === 'trial' && !trialEndsAtISO) {
          const FALLBACK_TRIAL_DAYS = 3;
          trialEndsAtISO = new Date(Date.now() + FALLBACK_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
          console.warn(`[WEBHOOK] subscription.trial_end missing for uid=${uid}; using fallback trialEndsAt=${trialEndsAtISO}`);
        }

        console.log(`✍️ WRITING TO D1: users.plan = ${effectivePlan} for uid=${uid}`);
        await updatePlanInD1(uid, {
          plan: effectivePlan,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          subscriptionStatus: subscription?.status || 'active',
          trialEndsAt: trialEndsAtISO,
          currentPeriodEnd: subscription?.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
          hasEverPaid: isPaidPlan(effectivePlan) ? 1 : undefined
        }, event.created);
        console.log(`✅ D1 WRITE SUCCESS: ${uid} → ${effectivePlan}`);
      } else {
        console.warn(`⚠️ SKIPPED PLAN UPDATE: effectivePlan=${effectivePlan}, uid=${uid}`);
      }
    }

    if (event.type === 'customer.subscription.created') {
      console.log(`🎯 WEBHOOK: ${event.type} received`);
      const status = event.data.object.status;
      const metadata = event.data.object.metadata || {};
      const originalPlan = metadata.original_plan;
      const items = event.data.object.items?.data || [];
      const pId = items[0]?.price?.id || '';
      const plan = priceToPlan(env, pId);
      const customerId = event.data.object.customer || null;
      const { uid, email: customerEmail } = await fetchCustomerInfo(customerId);

      let effectivePlan = 'free';
      if (status === 'trialing' && originalPlan === 'trial') {
        effectivePlan = 'trial'; // User is in trial period
      } else if (status === 'active') {
        // Extract plan from price ID (auto-converts trial to essential)
        effectivePlan = plan || 'essential';
      }

      const sub = event.data.object;
      const trialEndsAtISO = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

      // Ensure user row exists in D1 for first-time subscribers.
      // Skip if a tombstone exists — the account was intentionally deleted.
      if (uid) {
        const db = getDb(env);
        const existingUser = db ? await db.prepare('SELECT id FROM users WHERE auth_id = ?').bind(uid).first() : null;
        if (!existingUser) {
          const d1Tombstone = await isDeletedUser(env, uid);
          const kvTombstone = await env.JOBHACKAI_KV?.get(`deleted:${uid}`);
          if (d1Tombstone || kvTombstone) {
            console.log(`⏭️ [WEBHOOK] Skipping subscription.created plan update: user ${uid} was deleted (tombstone found)`);
            return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });
          }
          try {
            await getOrCreateUserByAuthId(env, uid, customerEmail, { updateActivity: false });
            console.log(`✅ [WEBHOOK] Ensured user row exists for subscriber: ${uid}`);
          } catch (createErr) {
            console.error(`❌ [WEBHOOK] Failed to create user row for ${uid}:`, createErr?.message || createErr);
            return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });
          }
        }
      }

      console.log(`📝 SUBSCRIPTION DATA: status=${status}, priceId=${pId}, basePlan=${plan}, effectivePlan=${effectivePlan}, uid=${uid}`);
      console.log(`🔄 TRIAL CONVERSION CHECK:`, {
        eventType: event.type,
        currentStatus: status,
        originalPlan: originalPlan,
        priceId: pId,
        mappedPlan: plan,
        effectivePlan: effectivePlan,
        trialEndsAt: trialEndsAtISO,
        subscriptionId: sub.id
      });
      console.log(`✍️ WRITING TO D1: users.plan = ${effectivePlan} for uid=${uid}`);
      
      await updatePlanInD1(uid, {
        plan: effectivePlan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        subscriptionStatus: status,
        trialEndsAt: trialEndsAtISO,
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        hasEverPaid: isPaidPlan(effectivePlan) ? 1 : undefined
      }, event.created);
      
      console.log(`✅ D1 WRITE SUCCESS: ${uid} → ${effectivePlan}${trialEndsAtISO ? ` (trial ends: ${trialEndsAtISO})` : ''}`);
    }

    if (event.type === 'customer.subscription.updated') {
      console.log('🎯 WEBHOOK: customer.subscription.updated received');
      const sub = event.data.object;
      const customerId = sub.customer || null;
      const { uid, email: customerEmail } = await fetchCustomerInfo(customerId);

      // Ensure user row exists in D1 for first-time subscribers.
      // Skip if a tombstone exists — the account was intentionally deleted.
      if (uid) {
        const db = getDb(env);
        const existingUser = db ? await db.prepare('SELECT id FROM users WHERE auth_id = ?').bind(uid).first() : null;
        if (!existingUser) {
          const d1Tombstone = await isDeletedUser(env, uid);
          const kvTombstone = await env.JOBHACKAI_KV?.get(`deleted:${uid}`);
          if (d1Tombstone || kvTombstone) {
            console.log(`⏭️ [WEBHOOK] Skipping subscription.updated plan update: user ${uid} was deleted (tombstone found)`);
            return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });
          }
          try {
            await getOrCreateUserByAuthId(env, uid, customerEmail, { updateActivity: false });
            console.log(`✅ [WEBHOOK] Ensured user row exists for subscriber: ${uid}`);
          } catch (createErr) {
            console.error(`❌ [WEBHOOK] Failed to create user row for ${uid}:`, createErr?.message || createErr);
            return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });
          }
        }
      }

      // Handle scheduled cancellation
      let cancelAt = null;
      if (sub.cancel_at_period_end === true && sub.cancel_at) {
        cancelAt = new Date(sub.cancel_at * 1000).toISOString();
        console.log(`✅ CANCELLATION SCHEDULED: ${uid} → ${cancelAt}`);
      }
      
      // Handle scheduled plan changes (downgrades)
      let scheduledPlan = null;
      let scheduledAt = null;
      const schedulePlan = sub.schedule;
      if (schedulePlan) {
        // Fetch schedule details from Stripe
        const schedRes = await fetch(`https://api.stripe.com/v1/subscription_schedules/${schedulePlan}`, {
          headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
        });
        const schedData = await schedRes.json();
        
        if (schedData && schedData.phases && schedData.phases.length > 1) {
          const nextPhase = schedData.phases[1];
          const nextPriceId = nextPhase.items[0]?.price;
          scheduledPlan = priceToPlan(env, nextPriceId);
          scheduledAt = nextPhase.start_date ? new Date(nextPhase.start_date * 1000).toISOString() : null;
          
          if (scheduledPlan && scheduledAt) {
            console.log(`✅ PLAN CHANGE SCHEDULED: ${uid} → ${scheduledPlan} at ${scheduledAt}`);
          }
        }
      }
      
      // Determine effective plan status
      const status = sub.status;
      const metadata = sub.metadata || {};
      const originalPlan = metadata.original_plan;
      const items = sub.items?.data || [];
      const pId = items[0]?.price?.id || '';
      const plan = priceToPlan(env, pId);
      
      // Get previous plan from D1 to detect trial conversion
      let previousPlan = null;
      try {
        const { getUserPlanData } = await import('../../_lib/db.js');
        const existingPlanData = await getUserPlanData(env, uid);
        previousPlan = existingPlanData?.plan || null;
      } catch (e) {
        console.warn('⚠️ Could not fetch previous plan for comparison:', e.message);
      }
      
      let effectivePlan = 'free';
      if (status === 'trialing' && originalPlan === 'trial') {
        effectivePlan = 'trial';
      } else if (status === 'active') {
        effectivePlan = plan || 'essential';
      }
      
      const trialEndsAtISO = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
      
      // Enhanced logging for trial conversion detection
      console.log(`🔄 TRIAL CONVERSION CHECK:`, {
        eventType: event.type,
        previousStatus: previousPlan || 'unknown', // Use actual previousPlan value, not assumed 'trial'
        currentStatus: status,
        previousPlan: previousPlan,
        originalPlan: originalPlan,
        priceId: pId,
        mappedPlan: plan,
        effectivePlan: effectivePlan,
        trialEndsAt: trialEndsAtISO,
        subscriptionId: sub.id,
        isTrialConversion: previousPlan === 'trial' && effectivePlan !== 'trial' && status === 'active'
      });
      
      if (previousPlan === 'trial' && effectivePlan !== 'trial' && status === 'active') {
        console.log(`🎉 TRIAL CONVERTED: ${uid} → ${effectivePlan} (trial expired, subscription now active)`);
        
        // Reset usage when converting from trial to paid plan
        // This ensures users get a fresh start with their new plan limits
        if (['essential', 'pro', 'premium'].includes(effectivePlan)) {
          console.log('[WEBHOOK] Resetting usage for trial conversion', {
            uid,
            fromPlan: previousPlan,
            toPlan: effectivePlan
          });
          
          // Reset interview questions usage (uses feature_daily_usage table)
          await resetFeatureDailyUsage(env, uid, 'interview_questions').catch((error) => {
            console.error('[WEBHOOK] Failed to reset interview questions usage (non-blocking):', error);
          });
          
          // Reset resume feedback usage (uses usage_events table)
          await resetUsageEvents(env, uid, 'resume_feedback').catch((error) => {
            console.error('[WEBHOOK] Failed to reset resume feedback usage (non-blocking):', error);
          });
        }
      }
      
      console.log(`✍️ UPDATING D1: users.plan = ${effectivePlan} for uid=${uid}`);
      await updatePlanInD1(uid, {
        plan: effectivePlan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        subscriptionStatus: status,
        trialEndsAt: trialEndsAtISO,
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        cancelAt: cancelAt || null, // null clears the field (undefined is skipped)
        scheduledPlan: scheduledPlan || null, // null clears the field (undefined is skipped)
        scheduledAt: scheduledAt || null, // null clears the field (undefined is skipped)
        hasEverPaid: isPaidPlan(effectivePlan) ? 1 : undefined
      }, event.created);
      
      console.log(`✅ D1 UPDATE SUCCESS: ${uid} → ${effectivePlan}${trialEndsAtISO ? ` (trial ends: ${trialEndsAtISO})` : ''}`);
    }

    if (event.type === 'customer.subscription.deleted') {
      console.log('🎯 WEBHOOK: customer.subscription.deleted received');
      const deletedSub = event.data?.object || {};
      const customerId = deletedSub.customer || null;
      const uid = await fetchUidFromCustomer(customerId);
      console.log(`📝 DELETION DATA: customerId=${customerId}, uid=${uid}`);
      const deletedItems = deletedSub?.items?.data || [];
      const deletedPriceId = deletedItems[0]?.price?.id || '';
      const deletedPlan = priceToPlan(env, deletedPriceId);

      let handledByActiveSub = false;
      if (customerId && uid) {
        try {
          const subsRes = await stripe(env, `/subscriptions?customer=${customerId}&status=all&limit=25`);
          if (subsRes.ok) {
            const subsData = await subsRes.json();
            const activeSubs = (subsData.data || []).filter((sub) =>
              sub && ['active', 'trialing', 'past_due'].includes(sub.status)
            );
            if (activeSubs.length > 0) {
              const { bestSub, currentPlan } = pickBestSubscription(activeSubs, env);
              const trialEndsAtISO = bestSub.trial_end ? new Date(bestSub.trial_end * 1000).toISOString() : null;
              const currentPeriodEnd = bestSub.current_period_end ? new Date(bestSub.current_period_end * 1000).toISOString() : null;
              const cancelAt = (bestSub.cancel_at_period_end && bestSub.cancel_at)
                ? new Date(bestSub.cancel_at * 1000).toISOString()
                : null;

              console.log(`✍️ [WEBHOOK] Remaining active subscription found, keeping plan ${currentPlan} for uid=${uid}`);
              await updatePlanInD1(uid, {
                plan: currentPlan,
                stripeCustomerId: customerId,
                stripeSubscriptionId: bestSub.id,
                subscriptionStatus: bestSub.status,
                trialEndsAt: trialEndsAtISO,
                currentPeriodEnd,
                cancelAt,
                scheduledPlan: null,
                scheduledAt: null,
                hasEverPaid: isPaidPlan(currentPlan) ? 1 : undefined
              }, event.created);
              handledByActiveSub = true;
            }
          } else {
            console.warn('[WEBHOOK] Failed to list subscriptions on deletion', subsRes.status);
          }
        } catch (subErr) {
          console.warn('[WEBHOOK] Subscription lookup error on deletion', subErr?.message || subErr);
        }
      }

      if (!handledByActiveSub) {
        console.log(`✍️ WRITING TO D1: users.plan = free for uid=${uid}`);
        await updatePlanInD1(uid, {
          plan: 'free',
          stripeSubscriptionId: null,
          subscriptionStatus: 'canceled',
          cancelAt: null, // Clear cancellation date
          scheduledPlan: null, // Clear scheduled plan
          scheduledAt: null, // Clear scheduled date
          hasEverPaid: isPaidPlan(deletedPlan) ? 1 : undefined
        }, event.created);

        // Clean up resume data when subscription is deleted (KV cleanup)
        await env.JOBHACKAI_KV?.delete(`user:${uid}:lastResume`);
        await env.JOBHACKAI_KV?.delete(`usage:${uid}`);
        console.log(`✅ D1 WRITE SUCCESS: ${uid} → free (resume data cleaned up)`);

        // Send subscription cancelled email (non-blocking)
        // Note: Stripe may also send its own cancellation email; we send ours for consistency
        if (uid) {
          try {
            // getUserPlanData does not return email, so query users table directly
            const db = getDb(env);
            const userRow = db ? await db.prepare('SELECT email FROM users WHERE auth_id = ?').bind(uid).first() : null;
            if (userRow?.email) {
              const userName = userRow.email.split('@')[0];
              const periodEnd = deletedSub.current_period_end
                ? new Date(deletedSub.current_period_end * 1000).toISOString()
                : null;
              const { subject, html } = subscriptionCancelledEmail(userName, deletedPlan, periodEnd);
              const emailPromise = sendEmail(env, { to: userRow.email, subject, html }).catch((e) => {
                console.warn('[WEBHOOK] Failed to send cancellation email (non-blocking):', e.message);
              });
              context.waitUntil(emailPromise);
            }
          } catch (emailErr) {
            console.warn('[WEBHOOK] Error sending cancellation email (non-blocking):', emailErr.message);
          }
        }
      }
    }

  } catch (err) {
    console.error('❌ WEBHOOK ERROR:', err.message || err);
    // swallow errors to avoid endless retries; state can heal on next login fetch
  }

  return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } });
}

async function verifyStripeWebhook(env, req, rawBody) {
  const sig = req.headers.get('stripe-signature') || '';
  const parts = Object.fromEntries(sig.split(',').map(p => p.split('=', 2)));
  if (!parts.t || !parts.v1) return false;
  const payload = `${parts.t}.${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2,'0')).join('');
  if (expected.length !== parts.v1.length) return false;
  let diff = 0; for (let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  const age = Math.abs(Date.now()/1000 - Number(parts.t));
  return diff === 0 && age <= 300;
}

const kvPlanKey = (uid) => `planByUid:${uid}`;
function priceToPlan(env, priceId) {
  if (!priceId) return null;
  // Normalize env price IDs across naming variants
  const essential = env.STRIPE_PRICE_ESSENTIAL_MONTHLY || env.PRICE_ESSENTIAL_MONTHLY || env.STRIPE_PRICE_ESSENTIAL || env.PRICE_ESSENTIAL;
  const pro = env.STRIPE_PRICE_PRO_MONTHLY || env.PRICE_PRO_MONTHLY || env.STRIPE_PRICE_PRO || env.PRICE_PRO;
  const premium = env.STRIPE_PRICE_PREMIUM_MONTHLY || env.PRICE_PREMIUM_MONTHLY || env.STRIPE_PRICE_PREMIUM || env.PRICE_PREMIUM;
  // Use if-statements to avoid undefined key collisions in map object
  if (priceId === essential) return 'essential';
  if (priceId === pro) return 'pro';
  if (priceId === premium) return 'premium';
  return null;
}

function isPaidPlan(plan) {
  return ['essential', 'pro', 'premium'].includes(plan);
}
