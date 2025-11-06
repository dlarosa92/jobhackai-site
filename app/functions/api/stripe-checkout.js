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
    console.log('🔵 [CHECKOUT] Request start', {
      method: request.method,
      origin,
      hasAuth: !!request.headers.get('authorization')
    });

    // Safely parse JSON body
    let body = null;
    try {
      body = await request.json();
    } catch (parseErr) {
      console.log('🔴 [CHECKOUT] Invalid JSON body', parseErr?.message || parseErr);
      return json({ ok: false, error: 'invalid_json' }, 400, origin, env);
    }
    console.log('🔵 [CHECKOUT] Parsed body', body);
    const { plan } = body || {};

    // Check required environment variables
    if (!env.FIREBASE_PROJECT_ID) {
      console.log('🔴 [CHECKOUT] Missing FIREBASE_PROJECT_ID');
      return json({ ok: false, error: 'Server configuration error' }, 500, origin, env);
    }
    if (!env.STRIPE_SECRET_KEY) {
      console.log('🔴 [CHECKOUT] Missing STRIPE_SECRET_KEY');
      return json({ ok: false, error: 'Server configuration error' }, 500, origin, env);
    }

    const token = getBearer(request);
    if (!token) {
      console.log('🔴 [CHECKOUT] Missing bearer token');
      return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    }
    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const email = (payload?.email) || '';
    if (!plan) {
      console.log('🔴 [CHECKOUT] Missing plan field');
      return json({ ok: false, error: 'Missing plan' }, 422, origin, env);
    }

    // Prevent multiple trials per user
    if (plan === 'trial') {
      const trialUsed = await env.JOBHACKAI_KV?.get(`trialUsedByUid:${uid}`);
      if (trialUsed) {
        console.log('🔴 [CHECKOUT] Trial already used for user', uid);
        return json({ ok: false, error: 'Trial already used. Please select a paid plan.' }, 400, origin, env);
      }
    }

    const priceId = planToPrice(env, plan);
    console.log('🔵 [CHECKOUT] Plan→Price', { plan, priceId, envKeys: Object.keys(env).filter(k => k.includes('PRICE_')) });
    if (!priceId) {
      console.log('🔴 [CHECKOUT] Invalid plan', { plan });
      return json({ ok: false, error: 'Invalid plan' }, 400, origin, env);
    }

    // Reuse or create customer
    let customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    if (!customerId) {
      console.log('🔵 [CHECKOUT] Creating Stripe customer for uid', uid);
      try {
        const res = await stripe(env, '/customers', {
          method: 'POST',
          headers: stripeFormHeaders(env),
          body: form({ email, 'metadata[firebaseUid]': uid })
        });
        const c = await res.json();
        if (!res.ok) {
          console.log('🔴 [CHECKOUT] Customer create failed', c);
          return json({ ok: false, error: c?.error?.message || 'stripe_customer_error' }, 502, origin, env);
        }
        customerId = c.id;
        await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
        await env.JOBHACKAI_KV?.put(kvEmailKey(uid), email);
      } catch (customerError) {
        console.log('🔴 [CHECKOUT] Customer create exception', customerError);
        return json({ ok: false, error: 'Failed to create customer' }, 500, origin, env);
      }
    }

    // Create Checkout Session (subscription)
    const idem = `${uid}:${plan}`;
    
    // Prepare session body with trial support
    const sessionBody = {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: (env.STRIPE_SUCCESS_URL || `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard.html?paid=1`),
      cancel_url: (env.STRIPE_CANCEL_URL || `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/pricing-a.html`),
      allow_promotion_codes: 'true',
      payment_method_collection: 'if_required',
      'metadata[firebaseUid]': uid,
      'metadata[plan]': plan
    };
    
    // Add trial period for trial plan
    if (plan === 'trial') {
      sessionBody['subscription_data[trial_period_days]'] = '3';
      sessionBody['subscription_data[metadata][original_plan]'] = plan;
    }
    
    console.log('🔵 [CHECKOUT] Creating session', { customerId, priceId });
    try {
      const sessionRes = await stripe(env, '/checkout/sessions', {
        method: 'POST',
        headers: { ...stripeFormHeaders(env), 'Idempotency-Key': idem },
        body: form(sessionBody)
      });
      const s = await sessionRes.json();
      if (!sessionRes.ok) {
        console.log('🔴 [CHECKOUT] Session create failed', s);
        return json({ ok: false, error: s?.error?.message || 'stripe_checkout_error' }, 502, origin, env);
      }
      console.log('✅ [CHECKOUT] Session created', { id: s.id, url: s.url });
      return json({ ok: true, url: s.url, sessionId: s.id }, 200, origin, env);
    } catch (sessionError) {
      console.log('🔴 [CHECKOUT] Session create exception', sessionError);
      return json({ ok: false, error: 'Failed to create checkout session' }, 500, origin, env);
    }

  } catch (e) {
    const errorMessage = e?.message || (e != null ? String(e) : 'server_error');
    const errorStack = e?.stack ? String(e.stack).substring(0, 200) : '';
    console.log('🔴 [CHECKOUT] Exception', {
      message: errorMessage,
      stack: errorStack,
      name: e?.name
    });
    // Return a user-friendly error message (don't expose stack traces)
    return json({ ok: false, error: errorMessage }, 500, origin, env);
  }
}

function stripe(env, path, init) {
  const url = `https://api.stripe.com/v1${path}`;
  const headers = new Headers(init?.headers || {});
  headers.set('Authorization', `Bearer ${env.STRIPE_SECRET_KEY}`);
  // Add a timeout to avoid hanging requests causing upstream 5xx
  const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
    ? AbortSignal.timeout(15000)
    : undefined;
  return fetch(url, { ...init, headers, signal });
}
function stripeFormHeaders(env) {
  return { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' };
}
function form(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null) p.append(k, String(v)); });
  return p.toString();
}
function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io'];
  const configured = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || 'https://dev.jobhackai.io');
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Stripe-Signature,Idempotency-Key',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  };
}
function json(body, status, origin, env) { return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin, env) }); }
const kvCusKey = (uid) => `cusByUid:${uid}`;
const kvEmailKey = (uid) => `emailByUid:${uid}`;
function planToPrice(env, plan) {
  const map = {
    trial: env.STRIPE_PRICE_ESSENTIAL_MONTHLY, // Use Essential price with trial period
    essential: env.STRIPE_PRICE_ESSENTIAL_MONTHLY,
    pro: env.STRIPE_PRICE_PRO_MONTHLY,
    premium: env.STRIPE_PRICE_PREMIUM_MONTHLY
  };
  return map[plan] || null;
}


