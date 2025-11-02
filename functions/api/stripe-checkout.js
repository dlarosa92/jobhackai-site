import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth';
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

    const body = await request.json();
    console.log('🔵 [CHECKOUT] Parsed body', body);
    const { plan } = body || {};

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
    }

    // Create Checkout Session (subscription)
    const idem = `${uid}:${plan}`;
    const sessionBody = {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: (env.STRIPE_SUCCESS_URL || `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard?paid=1`),
      cancel_url: (env.STRIPE_CANCEL_URL || `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/pricing-a`),
      allow_promotion_codes: 'true',
      payment_method_collection: 'if_required',
      'metadata[firebaseUid]': uid,
      'metadata[plan]': plan
    };
    if (plan === 'trial') {
      sessionBody['subscription_data[trial_period_days]'] = '3';
      sessionBody['subscription_data[metadata][original_plan]'] = plan;
    }

    console.log('🔵 [CHECKOUT] Creating session', { customerId, priceId });
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
  } catch (e) {
    console.log('🔴 [CHECKOUT] Exception', e?.message || e);
    return json({ ok: false, error: e?.message || 'server_error' }, 500, origin, env);
  }
}

function stripe(env, path, init) {
  const url = `https://api.stripe.com/v1${path}`;
  const headers = new Headers(init?.headers || {});
  headers.set('Authorization', `Bearer ${env.STRIPE_SECRET_KEY}`);
  return fetch(url, { ...init, headers });
}
function stripeFormHeaders(env) {
  return { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' };
}
function form(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null) p.append(k, String(v)); });
  return p;
}
function corsHeaders(origin, env) {
  const expected = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : 'https://dev.jobhackai.io';
  const allowed = origin === expected ? origin : expected;
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,Stripe-Signature,Idempotency-Key', 'Vary': 'Origin', 'Content-Type': 'application/json' };
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


