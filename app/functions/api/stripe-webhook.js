export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://dev.jobhackai.io', 'Vary': 'Origin' } });

  // Read raw body for signature verification
  const raw = await request.text();
  const valid = await verifyStripeWebhook(env, request, raw);
  if (!valid) return new Response('Invalid signature', { status: 401, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://dev.jobhackai.io', 'Vary': 'Origin' } });

  const event = JSON.parse(raw);

  // Event de-duplication (24h) AFTER verification
  try {
    if (event && event.id) {
      const seenKey = `evt:${event.id}`;
      const seen = await env.JOBHACKAI_KV?.get(seenKey);
      if (seen) {
        return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://dev.jobhackai.io', 'Vary': 'Origin' } });
      }
      await env.JOBHACKAI_KV?.put(seenKey, '1', { expirationTtl: 86400 });
    }
  } catch (_) { /* no-op */ }

  // Helper to set plan by uid in KV; subscription events should win via timestamp ordering
  const setPlan = async (uid, value, tsSeconds) => {
    if (!uid) return;
    const tsKey = `planTsByUid:${uid}`;
    try {
      const last = parseInt((await env.JOBHACKAI_KV?.get(tsKey)) || '0', 10);
      const nextTs = Number.isFinite(tsSeconds) ? Number(tsSeconds) : Math.floor(Date.now() / 1000);
      if (nextTs >= last) {
        await env.JOBHACKAI_KV?.put(kvPlanKey(uid), value);
        await env.JOBHACKAI_KV?.put(tsKey, String(nextTs));
      }
    } catch (_) {
      // Fallback without ordering if KV read fails
      await env.JOBHACKAI_KV?.put(kvPlanKey(uid), value);
    }
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
      console.log('🎯 WEBHOOK: checkout.session.completed received');
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
      console.log(`📝 CHECKOUT DATA: priceId=${priceId}, plan=${plan}, customerId=${customerId}, uid=${uid}`);
      if (plan && uid) {
        console.log(`✍️ WRITING TO KV: planByUid:${uid} = ${plan}`);
        await setPlan(uid, plan, event.created || Math.floor(Date.now()/1000));
        console.log(`✅ KV WRITE SUCCESS: ${uid} → ${plan}`);
      } else {
        console.warn(`⚠️ SKIPPED KV WRITE: plan=${plan}, uid=${uid}`);
      }
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      console.log(`🎯 WEBHOOK: ${event.type} received`);
      const status = event.data.object.status;
      const metadata = event.data.object.metadata || {};
      const originalPlan = metadata.original_plan;
      const items = event.data.object.items?.data || [];
      const pId = items[0]?.price?.id || '';
      const plan = priceToPlan(env, pId);
      const customerId = event.data.object.customer || null;
      const uid = await fetchUidFromCustomer(customerId);
      
      let effectivePlan = 'free';
      if (status === 'trialing' && originalPlan === 'trial') {
        effectivePlan = 'trial'; // User is in trial period
      } else if (status === 'active') {
        // Extract plan from price ID (auto-converts trial to essential)
        effectivePlan = plan || 'essential';
      }
      
      console.log(`📝 SUBSCRIPTION DATA: status=${status}, priceId=${pId}, basePlan=${plan}, effectivePlan=${effectivePlan}, uid=${uid}`);
      console.log(`✍️ WRITING TO KV: planByUid:${uid} = ${effectivePlan}`);
      await setPlan(uid, effectivePlan, event.created || Math.floor(Date.now()/1000));
      console.log(`✅ KV WRITE SUCCESS: ${uid} → ${effectivePlan}`);

      // Store trial end date if this is a trial subscription
      if (effectivePlan === 'trial' && event.data.object.trial_end) {
        await env.JOBHACKAI_KV?.put(`trialEndByUid:${uid}`, String(event.data.object.trial_end));
        console.log(`✅ TRIAL END DATE STORED: ${new Date(event.data.object.trial_end * 1000).toISOString()}`);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      console.log('🎯 WEBHOOK: customer.subscription.deleted received');
      const customerId = event.data.object.customer || null;
      const uid = await fetchUidFromCustomer(customerId);
      console.log(`📝 DELETION DATA: customerId=${customerId}, uid=${uid}`);
      console.log(`✍️ WRITING TO KV: planByUid:${uid} = free`);
      await setPlan(uid, 'free', event.created || Math.floor(Date.now()/1000));
      console.log(`✅ KV WRITE SUCCESS: ${uid} → free`);
    }
  } catch (err) {
    console.error('❌ WEBHOOK ERROR:', err.message || err);
    // swallow errors to avoid endless retries; state can heal on next login fetch
  }

  return new Response('[ok]', { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://dev.jobhackai.io', 'Vary': 'Origin' } });
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
    [env.STRIPE_PRICE_ESSENTIAL_MONTHLY]: 'essential',
    [env.STRIPE_PRICE_PRO_MONTHLY]: 'pro',
    [env.STRIPE_PRICE_PREMIUM_MONTHLY]: 'premium'
  };
  return rev[priceId] || null;
}


