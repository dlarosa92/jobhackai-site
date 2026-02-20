import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getUserPlanData } from '../_lib/db.js';
import { stripe, listSubscriptions, getPlanFromSubscription, invalidateBillingCaches } from '../_lib/billing-utils.js';

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
    sub && ['active', 'trialing', 'past_due'].includes(sub.status)
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
      if (res.ok && sub.current_period_end) {
        cancelAt = Math.max(cancelAt || 0, sub.current_period_end);
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
      const customers = searchRes.ok ? (searchData?.data || []) : [];
      if (customers.length > 0) {
        const uidMatches = customers.filter((c) => c?.metadata?.firebaseUid === uid);
        const candidates = uidMatches.length > 0 ? uidMatches : customers;
        customerId = candidates.sort((a, b) => b.created - a.created)[0]?.id || null;
      }
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
