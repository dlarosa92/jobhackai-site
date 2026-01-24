import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getUserPlanData, updateUserPlan, resetFeatureDailyUsage } from '../_lib/db.js';
import {
  stripe,
  planToPrice,
  priceIdToPlan,
  planRank,
  statusRank,
  getPlanFromSubscription,
  pickBestSubscription,
  listSubscriptions
} from '../_lib/billing-utils.js';

/**
 * POST /api/upgrade-plan
 * Safely upgrades a user to a paid plan without creating duplicate subscriptions.
 */
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
    const body = await request.json().catch(() => null);
    const targetPlanRaw = body?.targetPlan;
    const source = body?.source || 'unknown';
    const requestedReturnUrl = body?.returnUrl || request.headers.get('Referer') || '';

    const targetPlan = normalizePlan(targetPlanRaw);
    if (!targetPlan || !['essential', 'pro', 'premium'].includes(targetPlan)) {
      return json({ ok: false, code: 'INVALID_PLAN' }, 400, origin, env);
    }

    if (!env.FIREBASE_PROJECT_ID || !env.STRIPE_SECRET_KEY) {
      return json({ ok: false, code: 'SERVER_CONFIG' }, 500, origin, env);
    }

    const token = getBearer(request);
    if (!token) {
      return json({ ok: false, code: 'AUTH_REQUIRED' }, 401, origin, env);
    }

    let uid = null;
    let email = '';
    try {
      const authResult = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
      uid = authResult.uid;
      email = authResult.payload?.email || '';
    } catch (authError) {
      console.log('[BILLING-UPGRADE] Auth failed', {
        error: authError?.message || authError,
        name: authError?.name
      });
      return json({ ok: false, code: 'AUTH_REQUIRED' }, 401, origin, env);
    }

    const returnUrl = safeReturnUrl(requestedReturnUrl, env);

    console.log('[BILLING-UPGRADE] Request', {
      uid,
      targetPlan,
      source,
      returnUrl
    });

    const customerId = await resolveCustomerId(env, uid, email);
    if (!customerId) {
      return json({ ok: false, code: 'CUSTOMER_NOT_FOUND' }, 500, origin, env);
    }

    const subs = await listSubscriptions(env, customerId);
    const activeSubs = subs.filter((sub) =>
      sub && ['active', 'trialing', 'past_due'].includes(sub.status)
    );

    if (activeSubs.length === 0) {
      const priceId = planToPrice(env, targetPlan);
      if (!priceId) {
        return json({ ok: false, code: 'INVALID_PLAN' }, 400, origin, env);
      }

      const sessionBody = {
        mode: 'subscription',
        customer: customerId,
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': 1,
        success_url: returnUrl,
        cancel_url: returnUrl,
        allow_promotion_codes: 'true',
        payment_method_collection: 'always',
        'metadata[firebaseUid]': uid,
        'metadata[plan]': targetPlan,
        'metadata[upgrade_source]': source
      };

      const idem = await makeUpgradeIdemKey(uid, `checkout-${targetPlan}`);
      const sessionRes = await stripe(env, '/checkout/sessions', {
        method: 'POST',
        headers: { ...stripeFormHeaders(env), 'Idempotency-Key': idem },
        body: form(sessionBody)
      });

      if (!sessionRes.ok) {
        const errText = await sessionRes.text();
        let errData = {};
        try { errData = JSON.parse(errText); } catch (_) {}
        console.log('[BILLING-UPGRADE] Checkout session failed', {
          uid,
          targetPlan,
          status: sessionRes.status,
          error: errData?.error?.message || errText
        });
        return json({ ok: false, code: 'CHECKOUT_FAILED' }, 502, origin, env);
      }

      const session = await sessionRes.json();
      return json({ ok: true, action: 'redirect', url: session.url }, 200, origin, env);
    }

    const { bestSub, currentPlan } = pickBestSubscription(activeSubs, env);
    const currentPlanRank = planRank(currentPlan);
    const targetPlanRank = planRank(targetPlan);
    const isTrialing = bestSub.status === 'trialing';

    if (currentPlanRank > targetPlanRank) {
      console.log('[BILLING-UPGRADE] Downgrade blocked', {
        uid,
        currentPlan,
        targetPlan,
        subId: bestSub.id
      });
      return json({ ok: false, code: 'DOWNGRADE_NOT_ALLOWED', plan: currentPlan }, 409, origin, env);
    }

    if (currentPlanRank === targetPlanRank && !isTrialing) {
      console.log('[BILLING-UPGRADE] Already on plan', {
        uid,
        currentPlan,
        targetPlan,
        subId: bestSub.id
      });
      return json({ ok: false, code: 'ALREADY_ON_PLAN', plan: currentPlan }, 409, origin, env);
    }

    const item = bestSub.items?.data?.[0];
    const itemId = item?.id;
    const currentPriceId = item?.price?.id || null;
    const targetPriceId = planToPrice(env, targetPlan);

    if (!itemId || !targetPriceId) {
      console.log('[BILLING-UPGRADE] Missing subscription item or price', {
        uid,
        subId: bestSub.id,
        itemId,
        targetPriceId
      });
      return json({ ok: false, code: 'SUBSCRIPTION_ITEM_MISSING' }, 500, origin, env);
    }

    const needsPriceChange = currentPriceId !== targetPriceId;
    const updateBody = {
      'metadata[plan]': targetPlan,
      'metadata[upgrade_source]': source
    };

    if (needsPriceChange) {
      updateBody['items[0][id]'] = itemId;
      updateBody['items[0][price]'] = targetPriceId;
      updateBody.proration_behavior = 'always_invoice';
    }

    if (isTrialing) {
      updateBody.trial_end = 'now';
      updateBody.proration_behavior = updateBody.proration_behavior || 'always_invoice';
    }

    const idem = await makeUpgradeIdemKey(uid, `${bestSub.id}:${targetPlan}`);
    const updateRes = await stripe(env, `/subscriptions/${bestSub.id}`, {
      method: 'POST',
      headers: { ...stripeFormHeaders(env), 'Idempotency-Key': idem },
      body: form(updateBody)
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      let errData = {};
      try { errData = JSON.parse(errText); } catch (_) {}
      console.log('[BILLING-UPGRADE] Subscription update failed', {
        uid,
        subId: bestSub.id,
        status: updateRes.status,
        error: errData?.error?.message || errText
      });
      return json({ ok: false, code: 'UPDATE_FAILED' }, 502, origin, env);
    }

    await invalidateBillingCaches(env, uid);

    // Reset interview questions usage when upgrading from trial to paid plan
    // This ensures users get a fresh start with their new plan limits
    if (currentPlan === 'trial' && ['essential', 'pro', 'premium'].includes(targetPlan)) {
      console.log('[BILLING-UPGRADE] Resetting interview questions usage for trial upgrade', {
        uid,
        fromPlan: currentPlan,
        toPlan: targetPlan
      });
      await resetFeatureDailyUsage(env, uid, 'interview_questions').catch((error) => {
        // Log but don't fail the upgrade if usage reset fails
        console.error('[BILLING-UPGRADE] Failed to reset usage (non-blocking):', error);
      });
    }

    console.log('[BILLING-UPGRADE] Subscription updated', {
      uid,
      targetPlan,
      subId: bestSub.id,
      customerId
    });

    return json({
      ok: true,
      action: 'updated',
      plan: targetPlan,
      subscriptionId: bestSub.id,
      customerId
    }, 200, origin, env);
  } catch (error) {
    console.log('[BILLING-UPGRADE] Exception', {
      message: error?.message || String(error),
      stack: error?.stack ? String(error.stack).substring(0, 200) : ''
    });
    return json({ ok: false, code: 'SERVER_ERROR' }, 500, origin, env);
  }
}

function normalizePlan(plan) {
  return typeof plan === 'string' ? plan.trim().toLowerCase() : null;
}

async function resolveCustomerId(env, uid, email) {
  let customerId = null;

  try {
    customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
  } catch (e) {
    console.log('[BILLING-UPGRADE] KV read error', e?.message || e);
  }

  if (!customerId) {
    try {
      const userPlan = await getUserPlanData(env, uid);
      if (userPlan?.stripeCustomerId) {
        customerId = userPlan.stripeCustomerId;
        await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
      }
    } catch (e) {
      console.log('[BILLING-UPGRADE] D1 lookup error', e?.message || e);
    }
  }

  if (!customerId) {
    const res = await stripe(env, '/customers', {
      method: 'POST',
      headers: stripeFormHeaders(env),
      body: form({ email, 'metadata[firebaseUid]': uid })
    });
    if (!res.ok) {
      console.log('[BILLING-UPGRADE] Stripe customer create failed', res.status);
      return null;
    }
    const customer = await res.json();
    customerId = customer?.id || null;
    if (customerId) {
      await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
      await env.JOBHACKAI_KV?.put(kvEmailKey(uid), email);
      try {
        await updateUserPlan(env, uid, { stripeCustomerId: customerId });
      } catch (e) {
        console.log('[BILLING-UPGRADE] D1 customer update failed', e?.message || e);
      }
    }
  }

  return customerId;
}

async function makeUpgradeIdemKey(uid, seed) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const raw = `${uid}:${seed}:${day}`;
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(raw));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${uid}:${hex.slice(0, 16)}`;
  } catch (_) {
    return `${uid}:${seed}:${Date.now()}`;
  }
}

async function invalidateBillingCaches(env, uid) {
  if (!env.JOBHACKAI_KV) return;
  const keys = [
    `planByUid:${uid}`,
    `billingStatus:${uid}`,
    `trialUsedByUid:${uid}`,
    `trialEndByUid:${uid}`
  ];
  await Promise.all(keys.map((key) => env.JOBHACKAI_KV.delete(key).catch(() => null)));
}

function safeReturnUrl(returnUrl, env) {
  const fallback = env.FRONTEND_URL || 'https://dev.jobhackai.io';
  try {
    const base = new URL(fallback);
    const url = new URL(returnUrl || fallback, base);
    if (url.origin !== base.origin) return fallback;
    return url.toString();
  } catch (_) {
    return fallback;
  }
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
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  };
}

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, env)
  });
}

const kvCusKey = (uid) => `cusByUid:${uid}`;
const kvEmailKey = (uid) => `emailByUid:${uid}`;
