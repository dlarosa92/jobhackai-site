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
    // Import Firebase auth helpers with error handling
    let getBearer, verifyFirebaseIdToken;
    try {
      const firebaseAuth = await import('../_lib/firebase-auth.js');
      getBearer = firebaseAuth.getBearer;
      verifyFirebaseIdToken = firebaseAuth.verifyFirebaseIdToken;
      console.log('✅ Firebase auth helpers imported successfully');
    } catch (importError) {
      console.error('❌ Failed to import Firebase auth helpers:', importError);
      return json({ ok: false, error: 'Auth system unavailable', details: importError.message }, 500, origin, env);
    }
    console.log('🔍 Stripe checkout request received:', {
      method: request.method,
      hasAuth: !!request.headers.get('authorization'),
      origin
    });

    // Validate environment variables
    console.log('🔍 Environment check:', {
      hasStripeKey: !!env.STRIPE_SECRET_KEY,
      hasFirebaseProject: !!env.FIREBASE_PROJECT_ID,
      hasKv: !!env.JOBHACKAI_KV,
      hasPrices: {
        essential: !!env.STRIPE_PRICE_ESSENTIAL_MONTHLY,
        pro: !!env.STRIPE_PRICE_PRO_MONTHLY,
        premium: !!env.STRIPE_PRICE_PREMIUM_MONTHLY
      },
      actualValues: {
        essential: env.STRIPE_PRICE_ESSENTIAL_MONTHLY,
        pro: env.STRIPE_PRICE_PRO_MONTHLY,
        premium: env.STRIPE_PRICE_PREMIUM_MONTHLY
      },
      allEnvKeys: Object.keys(env).filter(k => k.includes('STRIPE') || k.includes('FIREBASE'))
    });

    const { plan, startTrial } = await request.json();
    console.log('🔍 Request data:', { plan, startTrial });

    const token = getBearer(request);
    if (!token) {
      console.log('❌ No authorization token');
      return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    }

    console.log('🔍 Verifying Firebase token...');
    let uid, payload;
    try {
      const tokenResult = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
      uid = tokenResult.uid;
      payload = tokenResult.payload;
      console.log('✅ Token verified:', { uid, email: payload?.email });
    } catch (tokenError) {
      console.error('❌ Token verification failed:', tokenError);
      return json({ ok: false, error: 'Invalid authentication token', details: tokenError.message }, 401, origin, env);
    }

    const email = (payload?.email) || '';
    if (!plan) {
      console.log('❌ Missing plan');
      return json({ ok: false, error: 'Missing plan' }, 422, origin, env);
    }

    console.log('🔍 Getting price ID for plan:', plan);
    const priceId = planToPrice(env, plan);
    console.log('🔍 Price ID:', priceId);
    
    if (!priceId) {
      console.log('❌ Invalid plan, no price ID found');
      return json({ ok: false, error: 'Invalid plan' }, 400, origin, env);
    }

    // Reuse or create customer
    console.log('🔍 Checking for existing customer:', kvCusKey(uid));
    let customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    
    if (!customerId) {
      console.log('🔍 Creating new Stripe customer for:', email);
      try {
        const res = await stripe(env, '/customers', {
          method: 'POST',
          headers: stripeFormHeaders(env),
          body: form({ email, 'metadata[firebaseUid]': uid })
        });
        const c = await res.json();
        console.log('🔍 Stripe customer response:', { ok: res.ok, status: res.status });
        
        if (!res.ok) {
          console.log('❌ Stripe customer creation failed:', c?.error);
          return json({ ok: false, error: c?.error?.message || 'stripe_customer_error' }, 502, origin, env);
        }
        
        customerId = c.id;
        console.log('✅ Customer created:', customerId);
        await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
        await env.JOBHACKAI_KV?.put(kvEmailKey(uid), email);
      } catch (error) {
        console.error('❌ Error creating Stripe customer:', error);
        return json({ ok: false, error: 'Failed to create customer', details: error.message }, 500, origin, env);
      }
    } else {
      console.log('✅ Using existing customer:', customerId);
    }

    // Create Checkout Session (subscription) with trial support
    const idem = `${uid}:${plan}:${startTrial ? 'trial' : 'paid'}`;
    console.log('🔍 Creating checkout session with idempotency key:', idem);
    
    // Build session configuration
    const sessionConfig = {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard?paid=1`,
      cancel_url: `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/pricing-a.html?canceled=1`,
      allow_promotion_codes: 'true',
      payment_method_collection: startTrial ? 'always' : 'if_required',
      'metadata[firebaseUid]': uid,
      'metadata[plan]': plan
    };
    
    // Add trial period if needed (requires card)
    if (startTrial) {
      console.log('🔍 Adding 3-day trial to session');
      sessionConfig['subscription_data[trial_period_days]'] = '3';
      sessionConfig['subscription_data[metadata][firebaseUid]'] = uid;
      sessionConfig['subscription_data[metadata][plan]'] = plan;
    }
    
    console.log('🔍 Session config:', {
      mode: sessionConfig.mode,
      customer: customerId,
      priceId,
      hasTrial: startTrial
    });
    
    try {
      console.log('🔍 Calling Stripe checkout/sessions API...');
      const sessionRes = await stripe(env, '/checkout/sessions', {
        method: 'POST',
        headers: { ...stripeFormHeaders(env), 'Idempotency-Key': idem },
        body: form(sessionConfig)
      });
      
      console.log('🔍 Checkout response:', { ok: sessionRes.ok, status: sessionRes.status });
      const s = await sessionRes.json();
      
      if (!sessionRes.ok) {
        console.log('❌ Checkout session creation failed:', s?.error);
        return json({ ok: false, error: s?.error?.message || 'stripe_checkout_error', details: s?.error }, 502, origin, env);
      }

      console.log('✅ Checkout session created:', { id: s.id, hasUrl: !!s.url });
      return json({ ok: true, url: s.url, sessionId: s.id }, 200, origin, env);
    } catch (error) {
      console.error('❌ Error creating checkout session:', error);
      return json({ ok: false, error: 'Failed to create checkout session', details: error.message }, 500, origin, env);
    }
  } catch (e) {
    console.error('❌ Unexpected error in stripe-checkout:', e);
    return json({ ok: false, error: e?.message || 'server_error', details: e?.stack }, 500, origin, env);
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
  // Dynamic CORS: support dev, qa, and production origins
  const allowedOrigins = [
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io', 
    'https://app.jobhackai.io'
  ];
  const allowed = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return { 
    'Access-Control-Allow-Origin': allowed, 
    'Access-Control-Allow-Methods': 'POST,OPTIONS', 
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Stripe-Signature,Idempotency-Key', 
    'Vary': 'Origin', 
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

function json(body, status, origin, env) { 
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin, env) }); 
}

const kvCusKey = (uid) => `cusByUid:${uid}`;
const kvEmailKey = (uid) => `emailByUid:${uid}`;

function planToPrice(env, plan) {
  const map = {
    essential: env.STRIPE_PRICE_ESSENTIAL_MONTHLY,
    pro: env.STRIPE_PRICE_PRO_MONTHLY,
    premium: env.STRIPE_PRICE_PREMIUM_MONTHLY,
    trial: env.STRIPE_PRICE_ESSENTIAL_MONTHLY  // trial uses essential price with trial_period_days
  };
  return map[plan] || null;
}


