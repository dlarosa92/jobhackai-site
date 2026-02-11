import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getUserPlanData, updateUserPlan, resetFeatureDailyUsage, resetUsageEvents } from '../_lib/db.js';
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

      const sessionSeed = `checkout-${targetPlan}:${(crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)}`;
      const idem = await makeUpgradeIdemKey(uid, sessionSeed);
      const sessionRes = await stripe(env, '/checkout/sessions', {
        method: 'POST',
        headers: { ...stripeFormHeaders(env), 'Idempotency-Key': idem },
        body: form(sessionBody)
      });

      if (!sessionRes.ok) {
        const errText = await sessionRes.text();
        let errData = {};
        try { errData = JSON.parse(errText); } catch (_) {}
        const stripeMessage = errData?.error?.message || errText || 'stripe_checkout_error';
        const responseStatus = sessionRes.status >= 400 && sessionRes.status < 500 ? 400 : 500;
        console.log('[BILLING-UPGRADE] Checkout session failed', {
          uid,
          targetPlan,
          status: sessionRes.status,
          error: stripeMessage
        });
        return json({ ok: false, code: 'CHECKOUT_FAILED', error: stripeMessage }, responseStatus, origin, env);
      }

      const session = await sessionRes.json();
      return json({ ok: true, action: 'redirect', url: session.url }, 200, origin, env);
    }

    const { bestSub, currentPlan } = pickBestSubscription(activeSubs, env);
    const currentPlanRank = planRank(currentPlan);
    const targetPlanRank = planRank(targetPlan);
    const isTrialing = bestSub.status === 'trialing';

    if (currentPlanRank > targetPlanRank) {
      console.log('[BILLING-UPGRADE] Downgrade requested', {
        uid,
        currentPlan,
        targetPlan,
        subId: bestSub.id
      });
      const scheduleResult = await scheduleDowngrade(env, bestSub, targetPlan, source);
      if (!scheduleResult.ok) {
        return json({ ok: false, code: scheduleResult.code || 'DOWNGRADE_SCHEDULE_FAILED' }, 500, origin, env);
      }
      return json({
        ok: true,
        action: 'scheduled',
        plan: currentPlan,
        scheduledPlan: targetPlan,
        scheduledAt: scheduleResult.scheduledAt || null
      }, 200, origin, env);
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
      const stripeMessage = errData?.error?.message || errText || 'stripe_update_error';
      const responseStatus = updateRes.status >= 400 && updateRes.status < 500 ? 400 : 500;
      console.log('[BILLING-UPGRADE] Subscription update failed', {
        uid,
        subId: bestSub.id,
        status: updateRes.status,
        error: stripeMessage
      });
      return json({ ok: false, code: 'UPDATE_FAILED', error: stripeMessage }, responseStatus, origin, env);
    }

    const updatedSub = await updateRes.json();
    await invalidateBillingCaches(env, uid);

    // Update D1 immediately for upgrades (webhook will still confirm later)
    try {
      await updateUserPlan(env, uid, {
        plan: targetPlan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: updatedSub?.id || bestSub.id,
        subscriptionStatus: updatedSub?.status || bestSub.status,
        trialEndsAt: updatedSub?.trial_end ? new Date(updatedSub.trial_end * 1000).toISOString() : null,
        currentPeriodEnd: updatedSub?.current_period_end ? new Date(updatedSub.current_period_end * 1000).toISOString() : null,
        cancelAt: (updatedSub?.cancel_at_period_end && updatedSub?.cancel_at)
          ? new Date(updatedSub.cancel_at * 1000).toISOString()
          : null,
        scheduledPlan: null,
        scheduledAt: null,
        hasEverPaid: 1
      });
    } catch (e) {
      console.warn('[BILLING-UPGRADE] D1 update failed (non-blocking):', e?.message || e);
    }

    // Cancel other active subscriptions immediately to prevent duplicate billing
    await cancelOtherSubscriptions(env, activeSubs, updatedSub?.id || bestSub.id);

    // Reset usage when upgrading from trial to paid plan
    // This ensures users get a fresh start with their new plan limits
    // Use isTrialing instead of currentPlan === 'trial' because currentPlan relies on
    // subscription metadata which may be missing/incorrect, while isTrialing directly
    // checks the subscription status which is the reliable source of truth
    if (isTrialing && ['essential', 'pro', 'premium'].includes(targetPlan)) {
      console.log('[BILLING-UPGRADE] Resetting usage for trial upgrade', {
        uid,
        fromPlan: currentPlan,
        toPlan: targetPlan,
        subscriptionStatus: bestSub.status
      });
      
      // Reset interview questions usage (uses feature_daily_usage table)
      await resetFeatureDailyUsage(env, uid, 'interview_questions').catch((error) => {
        console.error('[BILLING-UPGRADE] Failed to reset interview questions usage (non-blocking):', error);
      });
      
      // Reset resume feedback usage (uses usage_events table)
      await resetUsageEvents(env, uid, 'resume_feedback').catch((error) => {
        console.error('[BILLING-UPGRADE] Failed to reset resume feedback usage (non-blocking):', error);
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
      subscriptionId: updatedSub?.id || bestSub.id,
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
  let matchedCustomer = null;

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

  // Validate stored customer to avoid stale IDs causing checkout failures.
  if (customerId) {
    try {
      const customerCheckRes = await stripe(env, `/customers/${customerId}`);
      const customerCheckText = await customerCheckRes.text().catch(() => '');
      let customerCheckData = {};
      try {
        customerCheckData = customerCheckText ? JSON.parse(customerCheckText) : {};
      } catch (_) {}
      const customerCheckMessage = String(
        customerCheckData?.error?.message || customerCheckText || ''
      ).toLowerCase();
      const isDeletedCustomer = customerCheckData?.deleted === true;
      const isMissingCustomer = customerCheckMessage.includes('no such customer');

      if (isDeletedCustomer || isMissingCustomer) {
        console.log('[BILLING-UPGRADE] Stored customer is stale in Stripe. Clearing stale customer ID.', {
          uid,
          customerId,
          reason: isDeletedCustomer ? 'deleted' : 'missing'
        });
        customerId = null;
        try {
          await env.JOBHACKAI_KV?.delete(kvCusKey(uid));
        } catch (_) {}
        try {
          await updateUserPlan(env, uid, { stripeCustomerId: null });
        } catch (_) {}
      } else if (!customerCheckRes.ok) {
        console.log('[BILLING-UPGRADE] Customer validation failed but keeping ID', {
          uid,
          customerId,
          status: customerCheckRes.status
        });
      }
    } catch (e) {
      console.log('[BILLING-UPGRADE] Customer validation exception (non-fatal)', e?.message || e);
    }
  }

  if (!customerId && email) {
    try {
      const searchRes = await stripe(env, `/customers?email=${encodeURIComponent(email)}&limit=100`);
      const searchData = await searchRes.json();
      const customers = searchRes.ok
        ? (searchData?.data || []).filter((c) => c && c.deleted !== true)
        : [];
      if (customers.length > 0) {
        const uidMatches = customers.filter((c) => c?.metadata?.firebaseUid === uid);
        const candidates = uidMatches.length > 0 ? uidMatches : customers;
        if (uidMatches.length > 0) {
          console.log('[BILLING-UPGRADE] Found customers matching firebaseUid', { count: uidMatches.length });
        }

        if (candidates.length > 1) {
          for (const candidate of candidates) {
            const subsRes = await stripe(env, `/subscriptions?customer=${candidate.id}&status=all&limit=10`);
            if (subsRes.ok) {
              const subsData = await subsRes.json();
              const hasActive = (subsData?.data || []).some((sub) =>
                sub && ['active', 'trialing', 'past_due'].includes(sub.status)
              );
              if (hasActive) {
                matchedCustomer = candidate;
                break;
              }
            }
          }
          if (!matchedCustomer) {
            matchedCustomer = candidates.sort((a, b) => b.created - a.created)[0];
          }
        } else {
          matchedCustomer = candidates[0];
        }

        if (matchedCustomer?.id) {
          customerId = matchedCustomer.id;
          console.log('[BILLING-UPGRADE] Found Stripe customer by email fallback', {
            customerId,
            matchedUid: matchedCustomer?.metadata?.firebaseUid || null
          });
        }
      }
    } catch (e) {
      console.log('[BILLING-UPGRADE] Stripe email search failed', e?.message || e);
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
    matchedCustomer = customerId ? customer : null;
  }

  if (customerId) {
    await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
    try {
      await updateUserPlan(env, uid, { stripeCustomerId: customerId });
    } catch (e) {
      console.log('[BILLING-UPGRADE] D1 customer update failed', e?.message || e);
    }

    if (matchedCustomer && !matchedCustomer?.metadata?.firebaseUid) {
      try {
        await stripe(env, `/customers/${customerId}`, {
          method: 'POST',
          headers: stripeFormHeaders(env),
          body: form({ 'metadata[firebaseUid]': uid })
        });
      } catch (e) {
        console.log('[BILLING-UPGRADE] Failed to backfill customer metadata', e?.message || e);
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

async function cancelOtherSubscriptions(env, subs, keepSubId) {
  const toCancel = (subs || []).filter((sub) =>
    sub && sub.id && sub.id !== keepSubId && ['active', 'trialing', 'past_due'].includes(sub.status)
  );
  for (const sub of toCancel) {
    try {
      const res = await stripe(env, `/subscriptions/${sub.id}`, { method: 'DELETE' });
      if (!res.ok) {
        console.warn('[BILLING-UPGRADE] Failed to cancel extra subscription', sub.id, res.status);
      }
    } catch (e) {
      console.warn('[BILLING-UPGRADE] Error canceling extra subscription', sub.id, e?.message || e);
    }
  }
}

async function scheduleDowngrade(env, sub, targetPlan, source) {
  const targetPriceId = planToPrice(env, targetPlan);
  if (!targetPriceId) {
    return { ok: false, code: 'INVALID_PLAN' };
  }

  const item = sub?.items?.data?.[0];
  const currentPriceId = item?.price?.id || null;
  const quantity = item?.quantity || 1;
  const periodStart = sub?.current_period_start || Math.floor(Date.now() / 1000);
  const periodEnd = sub?.current_period_end || null;
  if (!currentPriceId || !periodEnd) {
    return { ok: false, code: 'SUBSCRIPTION_ITEM_MISSING' };
  }

  let scheduleId = sub.schedule || null;
  if (!scheduleId) {
    const createRes = await stripe(env, '/subscription_schedules', {
      method: 'POST',
      headers: stripeFormHeaders(env),
      body: form({ from_subscription: sub.id })
    });
    if (!createRes.ok) {
      return { ok: false, code: 'SCHEDULE_CREATE_FAILED' };
    }
    const created = await createRes.json();
    scheduleId = created?.id || null;
  }

  if (!scheduleId) {
    return { ok: false, code: 'SCHEDULE_CREATE_FAILED' };
  }

  const updateBody = {
    end_behavior: 'release',
    'phases[0][items][0][price]': currentPriceId,
    'phases[0][items][0][quantity]': quantity,
    'phases[0][start_date]': periodStart,
    'phases[0][end_date]': periodEnd,
    'phases[1][items][0][price]': targetPriceId,
    'phases[1][items][0][quantity]': quantity,
    'phases[1][start_date]': periodEnd,
    'phases[1][proration_behavior]': 'none',
    'metadata[scheduled_plan]': targetPlan,
    'metadata[upgrade_source]': source || 'unknown'
  };

  const updateRes = await stripe(env, `/subscription_schedules/${scheduleId}`, {
    method: 'POST',
    headers: stripeFormHeaders(env),
    body: form(updateBody)
  });

  if (!updateRes.ok) {
    return { ok: false, code: 'SCHEDULE_UPDATE_FAILED' };
  }

  return {
    ok: true,
    scheduledAt: new Date(periodEnd * 1000).toISOString()
  };
}
