import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { pickBestSubscription, priceIdToPlan } from '../_lib/billing-utils.js';
import { assertStripeKeyMatchesEnvironment } from '../_lib/stripe-environment.js';
import { readSubscriptionPeriod, readSubscriptionCancellation } from '../_lib/stripe-identity.js';
import { resolveBillingAccount, PortalOwnershipError } from '../_lib/billing-portal-owner.js';

const noSubscription = {
  ok: true, plan: 'free', status: 'none', trialEndsAt: null,
  currentPeriodEnd: null, cancelAt: null, hasPaymentMethod: false
};

/** Authenticated, display-only Stripe status. Never authorizes tool access. */
export async function onRequest({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin, env) });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin, env) });

  const token = getBearer(request);
  if (!token) return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
  let identity;
  try {
    identity = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
  } catch {
    return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
  }
  if (!assertStripeKeyMatchesEnvironment(env).ok) {
    return json({ ok: false, error: 'configuration error' }, 503, origin, env);
  }

  try {
    // KV billingStatus/cusByUid are shared by dev and QA and may be stale or
    // incorrectly mapped. Neither cached results nor cached identities grant
    // access to billing details. force=1 remains accepted but is unnecessary.
    const account = await resolveBillingAccount(env, { uid: identity.uid, email: identity.payload?.email || '' });
    if (!account) return json(noSubscription, 200, origin, env);
    const subscriptions = account.subscriptions.filter(sub =>
      ['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status));
    if (!subscriptions.length) return json(noSubscription, 200, origin, env);

    const { bestSub, currentPlan } = pickBestSubscription(subscriptions, env);
    const periodEnd = readSubscriptionPeriod(bestSub, { priceToPlan: id => priceIdToPlan(env, id) }).currentPeriodEnd;
    return json({
      ok: true,
      plan: currentPlan || 'free',
      status: bestSub.status,
      trialEndsAt: bestSub.trial_end ? bestSub.trial_end * 1000 : null,
      currentPeriodEnd: periodEnd ? Date.parse(periodEnd) : null,
      cancelAt: readSubscriptionCancellation(bestSub, periodEnd),
      hasPaymentMethod: !!(bestSub.default_payment_method || account.customer.invoice_settings?.default_payment_method || account.customer.default_source)
    }, 200, origin, env);
  } catch (error) {
    if (error instanceof PortalOwnershipError) return json({ ok: false, error: error.message }, error.status, origin, env);
    console.error('[BILLING-STATUS] Billing lookup unavailable');
    return json({ ok: false, error: 'Billing is temporarily unavailable. Please try again.' }, 503, origin, env);
  }
}

// Helper functions
function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io'];
  const configured = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || 'https://dev.jobhackai.io');
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json'
  };
}

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin, env) });
}
