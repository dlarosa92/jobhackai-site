import { updateUserPlan } from '../_lib/db.js';

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

  // Helper to update plan in D1 (source of truth) and optionally sync to KV during migration
  const updatePlanInD1 = async (uid, planData) => {
    if (!uid) return;
    try {
      // Write to D1 (source of truth)
      await updateUserPlan(env, uid, planData);
      
      // TEMPORARY: Dual-write to KV during migration period for safety
      // TODO: Remove KV writes after migration is verified
      if (planData.plan !== undefined) {
        await env.JOBHACKAI_KV?.put(kvPlanKey(uid), planData.plan);
      }
    } catch (error) {
      console.error('[WEBHOOK] Error updating plan in D1:', error);
      throw error;
    }
  };

  // Resolve uid from customer metadata when possible
  const fetchUidFromCustomer = async (customerId) => {
    if (!customerId) return null;
    const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    const c = await res.json();
    return c?.metadata?.firebaseUid || null;
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
      const uid = await fetchUidFromCustomer(customerId);
      
      // Determine effective plan based on original plan and subscription status
      let effectivePlan = 'free';
      if (originalPlan === 'trial') {
        effectivePlan = 'trial'; // Show as trial immediately
        // Mark trial as used
        await env.JOBHACKAI_KV?.put(`trialUsedByUid:${uid}`, '1');
        console.log(`✅ TRIAL MARKED AS USED: ${uid}`);
      } else {
        effectivePlan = priceToPlan(env, priceId) || 'essential';
      }
      
      console.log(`📝 CHECKOUT DATA: originalPlan=${originalPlan}, priceId=${priceId}, effectivePlan=${effectivePlan}, customerId=${customerId}, uid=${uid}`);
      if (effectivePlan && uid) {
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
        
        console.log(`✍️ WRITING TO D1: users.plan = ${effectivePlan} for uid=${uid}`);
        await updatePlanInD1(uid, {
          plan: effectivePlan,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          subscriptionStatus: subscription?.status || 'active',
          trialEndsAt: subscription?.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
          currentPeriodEnd: subscription?.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null
        });
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
      const uid = await fetchUidFromCustomer(customerId);
      
      let effectivePlan = 'free';
      if (status === 'trialing' && originalPlan === 'trial') {
        effectivePlan = 'trial'; // User is in trial period
      } else if (status === 'active') {
        // Extract plan from price ID (auto-converts trial to essential)
        effectivePlan = plan || 'essential';
      }
      
      console.log(`📝 SUBSCRIPTION DATA: status=${status}, priceId=${pId}, basePlan=${plan}, effectivePlan=${effectivePlan}, uid=${uid}`);
      console.log(`✍️ WRITING TO D1: users.plan = ${effectivePlan} for uid=${uid}`);
      
      const sub = event.data.object;
      await updatePlanInD1(uid, {
        plan: effectivePlan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        subscriptionStatus: status,
        trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
      });
      
      console.log(`✅ D1 WRITE SUCCESS: ${uid} → ${effectivePlan}`);
    }

    if (event.type === 'customer.subscription.updated') {
      console.log('🎯 WEBHOOK: customer.subscription.updated received');
      const sub = event.data.object;
      const customerId = sub.customer || null;
      const uid = await fetchUidFromCustomer(customerId);
      
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
      
      let effectivePlan = 'free';
      if (status === 'trialing' && originalPlan === 'trial') {
        effectivePlan = 'trial';
      } else if (status === 'active') {
        effectivePlan = plan || 'essential';
      }
      
      console.log(`✍️ UPDATING D1: users.plan = ${effectivePlan} for uid=${uid}`);
      await updatePlanInD1(uid, {
        plan: effectivePlan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        subscriptionStatus: status,
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        cancelAt: cancelAt || undefined, // undefined clears the field
        scheduledPlan: scheduledPlan || undefined,
        scheduledAt: scheduledAt || undefined
      });
    }

    if (event.type === 'customer.subscription.deleted') {
      console.log('🎯 WEBHOOK: customer.subscription.deleted received');
      const customerId = event.data.object.customer || null;
      const uid = await fetchUidFromCustomer(customerId);
      console.log(`📝 DELETION DATA: customerId=${customerId}, uid=${uid}`);
      console.log(`✍️ WRITING TO D1: users.plan = free for uid=${uid}`);
      
      await updatePlanInD1(uid, {
        plan: 'free',
        stripeSubscriptionId: null,
        subscriptionStatus: 'canceled',
        cancelAt: undefined, // Clear cancellation date
        scheduledPlan: undefined, // Clear scheduled plan
        scheduledAt: undefined
      });
      
      // Clean up resume data when subscription is deleted (KV cleanup)
      await env.JOBHACKAI_KV?.delete(`user:${uid}:lastResume`);
      await env.JOBHACKAI_KV?.delete(`usage:${uid}`);
      console.log(`✅ D1 WRITE SUCCESS: ${uid} → free (resume data cleaned up)`);
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



