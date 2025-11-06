import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth';

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

    // Get Stripe customer ID from KV
    const customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    if (!customerId) {
      console.log('🟡 [BILLING-PORTAL] No customer found for uid', uid);
      // Try to find by email in Stripe as fallback
      if (email) {
        const searchRes = await stripe(env, `/customers?email=${encodeURIComponent(email)}&limit=1`);
        const searchData = await searchRes.json();
        
        if (searchRes.ok && searchData.data && searchData.data.length > 0) {
          const foundCustomerId = searchData.data[0].id;
          console.log('🟡 [BILLING-PORTAL] Found customer by email', foundCustomerId);
          // Cache it for next time
          await env.JOBHACKAI_KV?.put(kvCusKey(uid), foundCustomerId);
          // Use the found customer ID
          return await createPortalSession(foundCustomerId, uid, origin, env);
        }
      }
      
      console.log('🔴 [BILLING-PORTAL] No customer exists - user needs to subscribe first');
      return json({ ok: false, error: 'No customer for user. Please subscribe first.' }, 404, origin, env);
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

  const p = await res.json();
  
  if (!res.ok) {
    console.log('🔴 [BILLING-PORTAL] Stripe API error', {
      uid,
      customerId,
      status: res.status,
      error: p?.error
    });
    return json({ ok: false, error: p?.error?.message || 'portal_error' }, 502, origin, env);
  }

  console.log('✅ [BILLING-PORTAL] Portal session created', { uid, customerId, url: p.url });
  return json({ ok: true, url: p.url }, 200, origin, env);
}

// Helper function to call Stripe API
function stripe(env, path, init) {
  const url = `https://api.stripe.com/v1${path}`;
  const headers = new Headers(init?.headers || {});
  headers.set('Authorization', `Bearer ${env.STRIPE_SECRET_KEY}`);
  return fetch(url, { ...init, headers });
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

const kvCusKey = (uid) => `cusByUid:${uid}`;


