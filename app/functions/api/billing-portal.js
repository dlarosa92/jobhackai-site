import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getUserPlanData } from '../_lib/db.js';
import {
  stripe,
  validateStripeCustomer,
  resolveStaleCustomerFromKV,
  clearCustomerReferences,
  cacheCustomerId,
  kvCusKey
} from '../_lib/billing-utils.js';

/**
 * POST /api/billing-portal
 * Creates a Stripe billing portal session for the authenticated user
 * Response: { ok: true, url } or { ok: false, error }
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
    console.log('🔵 [BILLING-PORTAL] Request received', {
      method: request.method,
      origin,
      hasAuth: !!request.headers.get('authorization')
    });

    const token = getBearer(request);
    if (!token) {
      console.log('🔴 [BILLING-PORTAL] Missing bearer token');
      return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    }

    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const email = (payload?.email) || '';
    console.log('🔵 [BILLING-PORTAL] Authenticated', { uid, email });

    // Step 1: Try KV (cache)
    let customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    let customerIdSource = customerId ? 'kv' : null;

    // Step 2: If KV miss, try D1 (authoritative)
    if (!customerId) {
      console.log('🟡 [BILLING-PORTAL] No customer found in KV for uid', uid);
      try {
        const userPlan = await getUserPlanData(env, uid);
        if (userPlan?.stripeCustomerId) {
          customerId = userPlan.stripeCustomerId;
          customerIdSource = 'd1';
          console.log('✅ [BILLING-PORTAL] Found customer ID in D1:', customerId);
          // Backfill KV cache only — D1 already has the value so
          // calling cacheCustomerId() here would trigger a redundant
          // updateUserPlan() round-trip that bumps updated_at/plan_updated_at.
          try { await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId); } catch (_) {}
        }
      } catch (d1Error) {
        console.warn('⚠️ [BILLING-PORTAL] D1 lookup failed (non-fatal):', d1Error?.message || d1Error);
      }
    }

    // Validate stored customer to avoid stale/deleted IDs causing Stripe failures.
    // When only KV was stale, D1 may have a newer valid id—check before clearing D1.
    if (customerId) {
      const resolved = await resolveStaleCustomerFromKV(env, uid, customerId, customerIdSource, '🟡 [BILLING-PORTAL]');
      customerId = resolved.customerId;
    }

    // Step 3: Only if both KV and D1 miss, fallback to Stripe email search (last resort)
    if (!customerId) {
      console.log('🟡 [BILLING-PORTAL] No customer in KV or D1, trying Stripe email search (last resort)');
      // Try to find by email in Stripe as last-resort fallback
      if (email) {
        const searchRes = await stripe(env, `/customers?email=${encodeURIComponent(email)}&limit=100`);
        const searchData = await searchRes.json();

        if (searchRes.ok && searchData?.data?.length > 0) {
          const liveCustomers = searchData.data.filter((c) => c && c.deleted !== true);
          const uidMatches = liveCustomers.filter((c) => c?.metadata?.firebaseUid === uid);
          const candidates = (uidMatches.length > 0 ? uidMatches : liveCustomers)
            .sort((a, b) => (b?.created || 0) - (a?.created || 0));

          for (const candidate of candidates) {
            if (!candidate?.id) continue;
            const candidateValidation = await validateStripeCustomer(env, candidate.id);
            if (candidateValidation.valid) {
              customerId = candidate.id;
              console.log('🟡 [BILLING-PORTAL] Found valid customer by email fallback', {
                uid,
                customerId,
                matchedUid: candidate?.metadata?.firebaseUid || null
              });
              await cacheCustomerId(env, uid, customerId);
              break;
            }
          }
        }
      }
      
      if (!customerId) {
        console.log('🔴 [BILLING-PORTAL] No valid customer exists - user needs to subscribe first');
        return json({ ok: false, error: 'No customer for user. Please subscribe first.' }, 404, origin, env);
      }
    }

    console.log('🔵 [BILLING-PORTAL] Creating portal session for customer', customerId);
    return await createPortalSession(customerId, uid, origin, env);

  } catch (e) {
    console.log('🔴 [BILLING-PORTAL] Exception', e?.message || e, e?.stack);
    return json({ ok: false, error: e?.message || 'server_error' }, 500, origin, env);
  }
}

async function createPortalSession(customerId, uid, origin, env) {
  const returnUrl = `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard`;
  
  console.log('🔵 [BILLING-PORTAL] Creating portal session', { customerId, uid });
  
  const portalParams = new URLSearchParams({
    customer: customerId,
    return_url: returnUrl
  });

  // Add portal configuration if available (for custom branding)
  if (env.STRIPE_PORTAL_CONFIGURATION_ID_DEV) {
    portalParams.append('configuration', env.STRIPE_PORTAL_CONFIGURATION_ID_DEV);
  } else if (env.STRIPE_PORTAL_CONFIGURATION_ID) {
    portalParams.append('configuration', env.STRIPE_PORTAL_CONFIGURATION_ID);
  }

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: portalParams
  });

  const raw = await res.text().catch(() => '');
  let p = {};
  try {
    p = raw ? JSON.parse(raw) : {};
  } catch (_) {
    p = {};
  }
  
  if (!res.ok) {
    const stripeMessage = p?.error?.message || raw || 'portal_error';
    const stripeMessageLower = String(stripeMessage).toLowerCase();

    console.log('🔴 [BILLING-PORTAL] Stripe API error', {
      uid,
      customerId,
      status: res.status,
      error: p?.error
    });

    if (stripeMessageLower.includes('no such customer')) {
      await clearCustomerReferences(env, uid);
      return json({ ok: false, error: stripeMessage, code: 'CUSTOMER_NOT_FOUND' }, 400, origin, env);
    }

    const responseStatus = res.status >= 400 && res.status < 500 ? 400 : 500;
    return json({ ok: false, error: stripeMessage }, responseStatus, origin, env);
  }

  if (!p?.url) {
    console.log('🔴 [BILLING-PORTAL] Invalid response payload', { uid, customerId });
    return json({ ok: false, error: 'Invalid response from Stripe' }, 500, origin, env);
  }

  console.log('✅ [BILLING-PORTAL] Portal session created', { uid, customerId, url: p.url });
  return json({ ok: true, url: p.url }, 200, origin, env);
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
    'Content-Type': 'application/json'
  };
}

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin, env) });
}
