export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  
  console.log('🔔 [WEBHOOK] Request received:', {
    method: request.method,
    hasSignature: !!request.headers.get('stripe-signature'),
    origin,
    timestamp: new Date().toISOString()
  });
  
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin, env) });

  // Read raw body for signature verification
  const raw = await request.text();
  const valid = await verifyStripeWebhook(env, request, raw);
  if (!valid) return new Response('Invalid signature', { status: 401, headers: corsHeaders(origin, env) });

  const event = JSON.parse(raw);
  
  console.log('🔔 [WEBHOOK] Event parsed:', {
    type: event.type,
    id: event.id,
    created: event.created,
    hasData: !!event.data
  });

  // Event de-duplication (24h) AFTER verification
  try {
    if (event && event.id) {
      const seenKey = `evt:${event.id}`;
      const seen = await env.JOBHACKAI_KV?.get(seenKey);
      if (seen) {
        return new Response('[ok]', { status: 200, headers: corsHeaders(origin, env) });
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
      if (plan && uid) await setPlan(uid, plan, event.created || Math.floor(Date.now()/1000));
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const status = subscription.status;
      const items = subscription.items?.data || [];
      const pId = items[0]?.price?.id || '';
      
      // Get uid from subscription metadata first (more reliable), then fallback to customer
      let uid = subscription.metadata?.firebaseUid;
      if (!uid) {
        const customerId = subscription.customer || null;
        uid = await fetchUidFromCustomer(customerId);
      }
      
      let effectivePlan = 'free';
      
      if (status === 'trialing') {
        // Check if this was originally a trial subscription
        const originalPlan = subscription.metadata?.plan;
        console.log('🔔 [WEBHOOK] Processing trialing status:', {
          uid,
          originalPlan,
          trialEnd: subscription.trial_end,
          metadata: subscription.metadata
        });
        
        if (originalPlan === 'trial') {
          effectivePlan = 'trial';
          console.log('✅ Setting plan to trial for user:', uid);
          
          // Store trial end date if available
          if (subscription.trial_end) {
            await env.JOBHACKAI_KV?.put(`trialEndByUid:${uid}`, String(subscription.trial_end));
            console.log('✅ Stored trial end date:', new Date(subscription.trial_end * 1000).toISOString());
          }
        } else {
          // Regular subscription in trial period
          effectivePlan = priceToPlan(env, pId) || 'essential';
          console.log('✅ Regular subscription in trial, plan:', effectivePlan);
        }
      } else if (status === 'active') {
        // Active subscription - convert from trial to paid plan
        const originalPlan = subscription.metadata?.plan;
        console.log('🔔 [WEBHOOK] Processing active status:', {
          uid,
          originalPlan,
          priceId: pId
        });
        
        if (originalPlan === 'trial') {
          // Trial ended, convert to essential
          effectivePlan = 'essential';
          console.log('✅ Trial ended, converting to essential for user:', uid);
          // Remove trial end date since trial is over
          await env.JOBHACKAI_KV?.delete(`trialEndByUid:${uid}`);
        } else {
          effectivePlan = priceToPlan(env, pId) || 'essential';
          console.log('✅ Active subscription, plan:', effectivePlan);
        }
      } else if (status === 'past_due' || status === 'unpaid') {
        // Subscription issues, but still has access
        effectivePlan = priceToPlan(env, pId) || 'essential';
        console.log('✅ Subscription issues but keeping access, plan:', effectivePlan);
      }
      
      await setPlan(uid, effectivePlan, event.created || Math.floor(Date.now()/1000));
      console.log('✅ Webhook set plan:', { uid, plan: effectivePlan, status });
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      
      // Get uid from subscription metadata first, then fallback to customer
      let uid = subscription.metadata?.firebaseUid;
      if (!uid) {
        const customerId = subscription.customer || null;
        uid = await fetchUidFromCustomer(customerId);
      }
      
      await setPlan(uid, 'free', event.created || Math.floor(Date.now()/1000));
    }
  } catch (_) {
    // swallow errors to avoid endless retries; state can heal on next login fetch
  }

  return new Response('[ok]', { status: 200, headers: corsHeaders(origin, env) });
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

function corsHeaders(origin, env) {
  // Dynamic CORS: support dev, qa, and production origins
  const allowedOrigins = [
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io', 
    'https://app.jobhackai.io'
  ];
  const allowed = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return { 
    'Cache-Control': 'no-store', 
    'Access-Control-Allow-Origin': allowed, 
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };
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


