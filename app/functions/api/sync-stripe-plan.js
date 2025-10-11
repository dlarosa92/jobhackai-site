import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin, env) });
  }

  try {
    console.log('🔄 Sync Stripe plan request received');

    // Verify Firebase auth token
    const token = getBearer(request);
    if (!token) {
      console.log('❌ No authorization token');
      return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    }

    let uid;
    try {
      const tokenResult = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
      uid = tokenResult.uid;
      console.log('✅ Token verified:', { uid });
    } catch (tokenError) {
      console.error('❌ Token verification failed:', tokenError);
      return json({ ok: false, error: 'Invalid authentication token' }, 401, origin, env);
    }

    // Get customer ID from KV
    const customerId = await env.JOBHACKAI_KV?.get(`cusByUid:${uid}`);
    if (!customerId) {
      console.log('❌ No Stripe customer found for user:', uid);
      return json({ ok: false, error: 'No Stripe customer found' }, 404, origin, env);
    }

    console.log('🔍 Found customer ID:', customerId);

    // Get current subscriptions from Stripe
    const stripeResponse = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=all&limit=10`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });

    if (!stripeResponse.ok) {
      console.error('❌ Stripe API error:', stripeResponse.status);
      return json({ ok: false, error: 'Failed to fetch subscription data' }, 500, origin, env);
    }

    const stripeData = await stripeResponse.json();
    const subscriptions = stripeData.data || [];
    
    console.log('🔍 Found subscriptions:', subscriptions.length);

    if (subscriptions.length === 0) {
      // No active subscriptions, set to free
      await env.JOBHACKAI_KV?.put(`planByUid:${uid}`, 'free');
      await env.JOBHACKAI_KV?.put(`planTsByUid:${uid}`, String(Math.floor(Date.now() / 1000)));
      return json({ ok: true, plan: 'free', trialEndsAt: null }, 200, origin, env);
    }

    // Get the most recent subscription
    const latestSub = subscriptions[0];
    const status = latestSub.status;
    const items = latestSub.items?.data || [];
    const priceId = items[0]?.price?.id || '';
    
    console.log('🔍 Latest subscription:', { 
      status, 
      priceId, 
      trialEnd: latestSub.trial_end,
      metadata: latestSub.metadata 
    });

    let plan = 'free';
    let trialEndsAt = null;

    // Determine plan based on subscription status and metadata
    if (status === 'trialing') {
      // Check if this was originally a trial subscription
      const originalPlan = latestSub.metadata?.plan;
      if (originalPlan === 'trial') {
        plan = 'trial';
        if (latestSub.trial_end) {
          trialEndsAt = new Date(latestSub.trial_end * 1000).toISOString();
          // Store trial end in KV
          await env.JOBHACKAI_KV?.put(`trialEndByUid:${uid}`, String(latestSub.trial_end));
        }
      } else {
        // Regular subscription in trial period
        plan = priceToPlan(env, priceId) || 'essential';
      }
    } else if (status === 'active') {
      // Active subscription
      plan = priceToPlan(env, priceId) || 'essential';
    } else if (status === 'past_due' || status === 'unpaid') {
      // Subscription issues, but still has access
      plan = priceToPlan(env, priceId) || 'essential';
    }
    // For cancelled, incomplete, etc., plan stays 'free'

    console.log('✅ Determined plan:', { plan, trialEndsAt });

    // Update KV with correct plan
    const timestamp = Math.floor(Date.now() / 1000);
    await env.JOBHACKAI_KV?.put(`planByUid:${uid}`, plan);
    await env.JOBHACKAI_KV?.put(`planTsByUid:${uid}`, String(timestamp));

    return json({ 
      ok: true, 
      plan, 
      trialEndsAt,
      subscriptionStatus: status,
      priceId 
    }, 200, origin, env);

  } catch (error) {
    console.error('❌ Error in sync-stripe-plan:', error);
    return json({ ok: false, error: 'Internal server error', details: error.message }, 500, origin, env);
  }
}

function priceToPlan(env, priceId) {
  const map = {
    [env.STRIPE_PRICE_ESSENTIAL_MONTHLY]: 'essential',
    [env.STRIPE_PRICE_PRO_MONTHLY]: 'pro',
    [env.STRIPE_PRICE_PREMIUM_MONTHLY]: 'premium'
  };
  return map[priceId] || null;
}

function corsHeaders(origin, env) {
  const allowedOrigins = [
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io', 
    'https://app.jobhackai.io'
  ];
  const allowed = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return { 
    'Access-Control-Allow-Origin': allowed, 
    'Access-Control-Allow-Methods': 'POST,OPTIONS', 
    'Access-Control-Allow-Headers': 'Content-Type,Authorization', 
    'Vary': 'Origin', 
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

function json(body, status, origin, env) { 
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin, env) }); 
}
