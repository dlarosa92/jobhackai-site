import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth';
export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
  }

  try {
    const { plan } = await request.json();
    const token = getBearer(request);
    if (!token) return json({ ok: false, error: 'unauthorized' }, 401, origin);
    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const email = (payload?.email) || '';
    if (!plan) {
      return json({ ok: false, error: 'Missing plan' }, 422, origin);
    }

    const priceId = planToPrice(env, plan);
    if (!priceId) return json({ ok: false, error: 'Invalid plan' }, 400, origin);

    // Reuse or create customer
    let customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    if (!customerId) {
      const res = await stripe(env, '/customers', {
        method: 'POST',
        headers: stripeFormHeaders(env),
        body: form({ email, 'metadata[firebaseUid]': uid })
      });
      const c = await res.json();
      if (!res.ok) return json({ ok: false, error: c?.error?.message || 'stripe_customer_error' }, 502, origin);
      customerId = c.id;
      await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
      await env.JOBHACKAI_KV?.put(kvEmailKey(uid), email);
    }

    // Create Checkout Session (subscription)
    const idem = `${firebaseUid}:${plan}`;
    const sessionRes = await stripe(env, '/checkout/sessions', {
      method: 'POST',
      headers: { ...stripeFormHeaders(env), 'Idempotency-Key': idem },
      body: form({
        mode: 'subscription',
        customer: customerId,
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': 1,
        success_url: `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard.html?paid=1`,
        cancel_url: `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/pricing-a.html`,
        allow_promotion_codes: 'true',
        payment_method_collection: 'if_required',
        'metadata[firebaseUid]': uid
      })
    });
    const s = await sessionRes.json();
    if (!sessionRes.ok) return json({ ok: false, error: s?.error?.message || 'stripe_checkout_error' }, 502, origin);

    return json({ ok: true, url: s.url, sessionId: s.id }, 200, origin);
  } catch (e) {
    return json({ ok: false, error: e?.message || 'server_error' }, 500, origin);
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
function corsHeaders(origin) {
  const allowed = origin === 'https://dev.jobhackai.io' ? origin : 'https://dev.jobhackai.io';
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,Stripe-Signature,Idempotency-Key', 'Vary': 'Origin', 'Content-Type': 'application/json' };
}
function json(body, status, origin) { return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) }); }
const kvCusKey = (uid) => `cusByUid:${uid}`;
const kvEmailKey = (uid) => `emailByUid:${uid}`;
function planToPrice(env, plan) {
  const map = {
    essential: env.PRICE_ESSENTIAL_MONTHLY,
    pro: env.PRICE_PRO_MONTHLY,
    premium: env.PRICE_PREMIUM_MONTHLY
  };
  return map[plan] || null;
}


