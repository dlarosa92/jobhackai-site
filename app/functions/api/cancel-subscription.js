import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getUserPlanData } from '../_lib/db.js';
import { stripe, listSubscriptions, getPlanFromSubscription, invalidateBillingCaches } from '../_lib/billing-utils.js';
import { assertStripeKeyMatchesEnvironment } from '../_lib/stripe-environment.js';
import { readSubscriptionPeriod } from '../_lib/stripe-identity.js';
import { ENTITLED_SUBSCRIPTION_STATUSES } from '../_lib/billing-ownership.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin, env) });
  }
  const token = getBearer(request);
  if (!token) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders(origin, env) });

  // This endpoint cancels subscriptions — refuse to run when the configured
  // Stripe key's mode contradicts the environment (prod=live, qa/dev=test).
  const keyCheck = assertStripeKeyMatchesEnvironment(env);
  if (!keyCheck.ok) {
    console.error(`[CANCEL] stripe key/environment mismatch: ${keyCheck.reason}`);
    return new Response(JSON.stringify({ ok: false, error: 'configuration error' }), { status: 503, headers: corsHeaders(origin, env) });
  }

  const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
  const email = payload?.email || '';

  const customerId = await resolveCustomerId(env, uid, email);
  if (!customerId) {
    return new Response(JSON.stringify({ ok: false, error: 'customer_not_found' }), { status: 404, headers: corsHeaders(origin, env) });
  }

  let subs;
  try {
    subs = await listSubscriptions(env, customerId);
  } catch (listErr) {
    console.error('[CANCEL] Failed to list subscriptions:', listErr.message);
    return new Response(JSON.stringify({ ok: false, error: 'Failed to retrieve subscriptions from Stripe' }), { status: 502, headers: corsHeaders(origin, env) });
  }
  const activeSubs = subs.filter((sub) =>
    sub && ENTITLED_SUBSCRIPTION_STATUSES.includes(sub.status)
  );

  if (activeSubs.length === 0) {
    return new Response(JSON.stringify({ ok: true, status: 'no_active_subscription' }), { status: 200, headers: corsHeaders(origin, env) });
  }

  const trialSubs = activeSubs.filter((sub) =>
    sub.status === 'trialing' && getPlanFromSubscription(sub, env) === 'trial'
  );
  const nonTrialSubs = activeSubs.filter((sub) => !trialSubs.includes(sub));

  let canceledTrialCount = 0;
  if (trialSubs.length > 0) {
    for (const sub of trialSubs) {
      try {
        const res = await stripe(env, `/subscriptions/${sub.id}`, { method: 'DELETE' });
        if (res.ok) {
          canceledTrialCount += 1;
        } else {
          console.warn('[CANCEL] Trial cancellation failed', sub.id, res.status);
        }
      } catch (_) {}
    }
  }

  if (nonTrialSubs.length === 0) {
    await invalidateBillingCaches(env, uid);
    return new Response(JSON.stringify({
      ok: true,
      status: 'canceled_immediately',
      canceledTrialCount
    }), { status: 200, headers: corsHeaders(origin, env) });
  }

  let cancelAt = null;
  for (const sub of nonTrialSubs) {
    try {
      const res = await stripe(env, `/subscriptions/${sub.id}`, {
        method: 'POST',
        headers: stripeFormHeaders(env),
        body: form({ cancel_at_period_end: 'true' })
      });
      if (res.ok) {
        // Period end may live on the subscription root or on subscription
        // items depending on the (unpinned) Stripe API version. Display-only
        // read: an unresolved period is recorded by the reader and reported
        // as "no date" — never guessed. (The D1 write happens via webhook.)
        const endIso = readSubscriptionPeriod(sub).currentPeriodEnd;
        const endEpoch = endIso ? Math.floor(Date.parse(endIso) / 1000) : null;
        if (endEpoch) cancelAt = Math.max(cancelAt || 0, endEpoch);
      }
    } catch (_) {}
  }

  await invalidateBillingCaches(env, uid);

  return new Response(JSON.stringify({
    ok: true,
    status: 'cancel_scheduled',
    canceledTrialCount,
    cancelAt: cancelAt ? new Date(cancelAt * 1000).toISOString() : null
  }), { status: 200, headers: corsHeaders(origin, env) });
}

async function resolveCustomerId(env, uid, email) {
  let customerId = null;
  try {
    customerId = await env.JOBHACKAI_KV?.get(`cusByUid:${uid}`);
  } catch (_) {}

  if (!customerId) {
    try {
      const userPlan = await getUserPlanData(env, uid);
      if (userPlan?.stripeCustomerId) {
        customerId = userPlan.stripeCustomerId;
        await env.JOBHACKAI_KV?.put(`cusByUid:${uid}`, customerId);
      }
    } catch (_) {}
  }

  if (!customerId && email) {
    try {
      const searchRes = await stripe(env, `/customers?email=${encodeURIComponent(email)}&limit=100`);
      const searchData = await searchRes.json();
      const customers = searchRes.ok ? (searchData?.data || []).filter((c) => c && c.deleted !== true) : [];
      // Destructive endpoint: only act on a customer explicitly stamped with
      // THIS user's firebaseUid. An email-only "newest wins" match could
      // cancel another user's subscription (emails are not unique in Stripe).
      const uidMatches = customers.filter((c) => c?.metadata?.firebaseUid === uid);
      customerId = uidMatches.sort((a, b) => b.created - a.created)[0]?.id || null;
    } catch (_) {}
  }

  return customerId;
}

function stripeFormHeaders(env) {
  return {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  };
}

function form(obj) {
  const params = new URLSearchParams();
  Object.entries(obj).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io'];
  const configured = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : null;
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
