export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Read raw body for signature verification
  const raw = await request.text();
  const valid = await verifyStripeWebhook(env, request, raw);
  if (!valid) return new Response('Invalid signature', { status: 401 });

  const event = JSON.parse(raw);

  // Helper to set plan by uid in KV
  const setPlan = async (uid, value) => {
    if (!uid) return;
    await env.JOBHACKAI_KV?.put(kvPlanKey(uid), value);
  };

  // Resolve uid from customer metadata when possible
  const fetchUidFromCustomer = async (customerId) => {
    if (!customerId) return null;
    const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    const c = await res.json();
    return c?.metadata?.firebaseUid || null;
  };

  try {
    if (event.type === 'checkout.session.completed') {
      const sessionId = event.data?.object?.id;
      // Expand line items to reliably get price id
      const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items.data.price`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
      const sess = await r.json();
      const priceId = sess?.line_items?.data?.[0]?.price?.id || '';
      const plan = priceToPlan(env, priceId);
      const customerId = sess?.customer || event.data?.object?.customer || null;
      const uid = await fetchUidFromCustomer(customerId);
      if (plan && uid) await setPlan(uid, plan);
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const status = event.data.object.status;
      const items = event.data.object.items?.data || [];
      const pId = items[0]?.price?.id || '';
      const plan = priceToPlan(env, pId);
      const customerId = event.data.object.customer || null;
      const uid = await fetchUidFromCustomer(customerId);
      const paid = status === 'active' || status === 'trialing';
      await setPlan(uid, paid && plan ? plan : 'free');
    }

    if (event.type === 'customer.subscription.deleted') {
      const customerId = event.data.object.customer || null;
      const uid = await fetchUidFromCustomer(customerId);
      await setPlan(uid, 'free');
    }
  } catch (_) {
    // swallow errors to avoid endless retries; state can heal on next login fetch
  }

  return new Response('[ok]', { status: 200 });
}

async function verifyStripeWebhook(env, req, rawBody) {
  const sig = req.headers.get('stripe-signature') || '';
  const parts = Object.fromEntries(sig.split(',').map(p => p.split('=', 2)));
  if (!parts.t || !parts.v1) return false;
  const payload = `${parts.t}.${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2,'0')).join('');
  if (expected.length !== parts.v1.length) return false;
  let diff = 0; for (let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  const age = Math.abs(Date.now()/1000 - Number(parts.t));
  return diff === 0 && age <= 300;
}

const kvPlanKey = (uid) => `planByUid:${uid}`;
function priceToPlan(env, priceId) {
  const rev = {
    [env.PRICE_ESSENTIAL_MONTHLY]: 'essential',
    [env.PRICE_PRO_MONTHLY]: 'pro',
    [env.PRICE_PREMIUM_MONTHLY]: 'premium'
  };
  return rev[priceId] || null;
}


