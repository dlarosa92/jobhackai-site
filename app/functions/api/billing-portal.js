import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { stripe } from '../_lib/billing-utils.js';
import { assertStripeKeyMatchesEnvironment } from '../_lib/stripe-environment.js';
import { resolvePortalCustomer, PortalOwnershipError } from '../_lib/billing-portal-owner.js';

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

    // Portal sessions mutate live billing; refuse when the configured key's
    // mode contradicts the environment (prod=live only, qa/dev=test only).
    const keyCheck = assertStripeKeyMatchesEnvironment(env);
    if (!keyCheck.ok) {
      console.error(`[BILLING-PORTAL] stripe key/environment mismatch: ${keyCheck.reason}`);
      return json({ ok: false, error: 'configuration error' }, 503, origin, env);
    }

    const token = getBearer(request);
    if (!token) {
      console.log('🔴 [BILLING-PORTAL] Missing bearer token');
      return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    }

    let identity;
    try {
      identity = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    } catch {
      return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    }
    const { uid, payload } = identity;
    const customerId = await resolvePortalCustomer(env, { uid, email: payload?.email || '' });
    if (!customerId) {
      return json({ ok: false, error: 'No billing account found. Please contact support if you have an existing purchase.' }, 404, origin, env);
    }
    return await createPortalSession(customerId, origin, env);
  } catch (e) {
    if (e instanceof PortalOwnershipError) return json({ ok: false, error: e.message }, e.status, origin, env);
    console.error('[BILLING-PORTAL] Billing lookup or session creation unavailable');
    return json({ ok: false, error: 'Billing is temporarily unavailable. Please try again.' }, 503, origin, env);
  }
}

async function createPortalSession(customerId, origin, env) {
  const returnUrl = `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard`;

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

  const res = await stripe(env, '/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: portalParams
  });

  if (!res.ok) throw new Error('Portal session unavailable');
  const p = await res.json();
  if (!p?.url) throw new Error('Invalid portal response');
  // Never log the bearer URL: it grants access to this customer's portal.

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
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json'
  };
}

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin, env) });
}
