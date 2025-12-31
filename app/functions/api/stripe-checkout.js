import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getUserPlanData, updateUserPlan } from '../_lib/db.js';
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
    
    // Verify Firebase token with error handling
    let uid, payload, email;
    try {
      const authResult = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
      uid = authResult.uid;
      payload = authResult.payload;
      email = (payload?.email) || '';
    } catch (authError) {
      console.log('🔴 [CHECKOUT] Firebase auth verification failed', {
        error: authError?.message || authError,
        name: authError?.name
      });
      return json({ ok: false, error: 'authentication_failed' }, 401, origin, env);
    }
    if (!plan) {
      console.log('🔴 [CHECKOUT] Missing plan field');
      return json({ ok: false, error: 'Missing plan' }, 422, origin, env);
    }

    // Prevent multiple trials per user - check has_ever_paid from D1
    if (plan === 'trial') {
      try {
        const userPlanData = await getUserPlanData(env, uid);
        if (userPlanData && userPlanData.hasEverPaid === 1) {
          console.log('🔴 [CHECKOUT] User has already had a paid subscription, trial not allowed', uid);
          return json({ 
            ok: false, 
            error: 'Trial is for first-time subscribers only. You\'re already subscribed, so you can switch plans anytime.',
            code: 'trial_not_available'
          }, 400, origin, env);
        }
        // Also check KV as fallback (for migration period)
        const trialUsed = await env.JOBHACKAI_KV?.get(`trialUsedByUid:${uid}`);
        if (trialUsed) {
          console.log('🔴 [CHECKOUT] Trial already used for user (KV check)', uid);
          return json({ 
            ok: false, 
            error: 'Trial already used. Please select a paid plan.',
            code: 'trial_already_used'
          }, 400, origin, env);
        }
      } catch (checkError) {
        console.log('🟡 [CHECKOUT] Error checking trial eligibility (non-fatal)', checkError?.message || checkError);
        // Continue - allow trial if check fails (fail open for availability)
      }
    }

    const priceId = planToPrice(env, plan);
    console.log('🔵 [CHECKOUT] Plan→Price', { plan, priceId, envKeys: Object.keys(env).filter(k => k.includes('PRICE_')) });
    if (!priceId) {
      console.log('🔴 [CHECKOUT] Invalid plan', { plan });
      return json({ ok: false, error: 'Invalid plan' }, 400, origin, env);
    }

    // Reuse or create customer
    let customerId = null;
    try {
      customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    } catch (kvError) {
      console.log('🟡 [CHECKOUT] KV read error (non-fatal)', kvError?.message || kvError);
      // Continue without cached customer ID - will create new one
    }
    
    if (!customerId) {
      console.log('🔵 [CHECKOUT] Creating Stripe customer for uid', uid);
      try {
        const res = await stripe(env, '/customers', {
          method: 'POST',
          headers: stripeFormHeaders(env),
          body: form({ email, 'metadata[firebaseUid]': uid })
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: { message: errorText || 'Unknown Stripe error' } };
          }
          console.log('🔴 [CHECKOUT] Customer create failed', {
            status: res.status,
            statusText: res.statusText,
            error: errorData
          });
          const msg = errorData?.error?.message || 'stripe_customer_error';
          const code = errorData?.error?.type || 'stripe_error';
          const status = (res.status >= 400 && res.status < 500) ? res.status : 400;
          return json({ ok: false, error: msg, code }, status, origin, env);
        }
        
        const c = await res.json();
        if (!c || !c.id) {
          console.log('🔴 [CHECKOUT] Invalid customer response', c);
          return json({ ok: false, error: 'Invalid response from Stripe' }, 502, origin, env);
        }
        
        customerId = c.id;
        
        // Try to cache customer ID (non-blocking)
        try {
          await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
          await env.JOBHACKAI_KV?.put(kvEmailKey(uid), email);
        } catch (kvWriteError) {
          console.log('🟡 [CHECKOUT] KV write error (non-fatal)', kvWriteError?.message || kvWriteError);
          // Continue - customer was created successfully
        }
      } catch (customerError) {
        console.log('🔴 [CHECKOUT] Customer create exception', {
          error: customerError?.message || customerError,
          stack: customerError?.stack?.substring(0, 200)
        });
        return json({ ok: false, error: 'Failed to create customer' }, 500, origin, env);
      }
    }

    // Check for existing active subscriptions and update instead of creating new
    if (customerId) {
      try {
        console.log('🔵 [CHECKOUT] Checking for existing subscriptions for customer', customerId);
        const subsRes = await stripe(env, `/subscriptions?customer=${customerId}&status=all&limit=10`);
        
        if (subsRes.ok) {
          const subsData = await subsRes.json();
          const subscriptions = subsData.data || [];
          
          // Find active or trialing subscriptions
          const activeSubscriptions = subscriptions.filter(s => 
            s.status === 'active' || s.status === 'trialing' || s.status === 'past_due'
          );
          
          if (activeSubscriptions.length > 0) {
            // Use the most recent active subscription
            const existingSub = activeSubscriptions.sort((a, b) => b.created - a.created)[0];
            const existingSubId = existingSub.id;
            const existingPriceId = existingSub.items?.data?.[0]?.price?.id;
            
            console.log('🔵 [CHECKOUT] Found existing subscription', {
              subscriptionId: existingSubId,
              status: existingSub.status,
              currentPriceId: existingPriceId,
              newPriceId: priceId
            });
            
            // If upgrading to a different plan, update the subscription
            if (existingPriceId !== priceId) {
              console.log('🔄 [CHECKOUT] Updating existing subscription to new plan');
              
              // Get the subscription item ID to update
              const subscriptionItemId = existingSub.items?.data?.[0]?.id;
              
              if (!subscriptionItemId) {
                console.log('🔴 [CHECKOUT] No subscription item found to update');
                // Fall through to create new checkout session
              } else {
                try {
                  // Update subscription: replace the subscription item with new price
                  const updateBody = {
                    'items[0][id]': subscriptionItemId,
                    'items[0][price]': priceId,
                    'proration_behavior': 'always_invoice', // Prorate charges for plan change
                    'metadata[plan]': plan,
                    'metadata[firebaseUid]': uid
                  };
                  
                  // If upgrading to trial, add trial period
                  if (plan === 'trial') {
                    updateBody['trial_period_days'] = '3';
                    updateBody['metadata[original_plan]'] = plan;
                  }
                  
                  const updateRes = await stripe(env, `/subscriptions/${existingSubId}`, {
                    method: 'POST',
                    headers: stripeFormHeaders(env),
                    body: form(updateBody)
                  });
                  
                  if (updateRes.ok) {
                    const updatedSub = await updateRes.json();
                    console.log('✅ [CHECKOUT] Subscription updated successfully', {
                      subscriptionId: existingSubId,
                      newPriceId: priceId
                    });
                    
                    // Set has_ever_paid = 1 if upgrading to a paid plan
                    const paidPlans = ['essential', 'pro', 'premium'];
                    if (paidPlans.includes(plan)) {
                      try {
                        await updateUserPlan(env, uid, { hasEverPaid: 1 });
                        console.log('✅ [CHECKOUT] Set has_ever_paid = 1 for paid plan upgrade');
                      } catch (paidError) {
                        console.log('🟡 [CHECKOUT] Failed to set has_ever_paid (non-fatal)', paidError?.message || paidError);
                      }
                    }
                    
                    // Cancel other active subscriptions to prevent multiple subscriptions
                    const otherSubscriptions = activeSubscriptions.filter(s => s.id !== existingSubId);
                    for (const otherSub of otherSubscriptions) {
                      try {
                        console.log('🔄 [CHECKOUT] Cancelling other subscription', otherSub.id);
                        await stripe(env, `/subscriptions/${otherSub.id}`, {
                          method: 'DELETE',
                          headers: stripeFormHeaders(env)
                        });
                        console.log('✅ [CHECKOUT] Cancelled subscription', otherSub.id);
                      } catch (cancelError) {
                        console.log('🟡 [CHECKOUT] Failed to cancel subscription (non-fatal)', {
                          subscriptionId: otherSub.id,
                          error: cancelError?.message || cancelError
                        });
                        // Continue - non-critical
                      }
                    }
                    
                    // Return success - subscription will be updated via webhook
                    // Redirect to dashboard with paid=1 to trigger plan refresh
                    return json({ 
                      ok: true, 
                      url: `${env.STRIPE_SUCCESS_URL || `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard.html?paid=1`}`,
                      sessionId: null,
                      updated: true
                    }, 200, origin, env);
                  } else {
                    const errorText = await updateRes.text();
                    let errorData;
                    try {
                      errorData = JSON.parse(errorText);
                    } catch {
                      errorData = { error: { message: errorText || 'Unknown Stripe error' } };
                    }
                    console.log('🔴 [CHECKOUT] Subscription update failed', {
                      status: updateRes.status,
                      error: errorData
                    });
                    // Fall through to create new checkout session as fallback
                  }
                } catch (updateError) {
                  console.log('🔴 [CHECKOUT] Subscription update exception', {
                    error: updateError?.message || updateError,
                    stack: updateError?.stack?.substring(0, 200)
                  });
                  // Fall through to create new checkout session as fallback
                }
              }
            } else {
              // Same plan - user already has an active subscription for this price.
              // Don't create a duplicate checkout session; redirect user to dashboard instead.
              console.log('ℹ️ [CHECKOUT] User already has this plan, returning early to avoid duplicate subscription');
              return json({
                ok: true,
                url: (env.STRIPE_SUCCESS_URL || `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard.html`),
                sessionId: null,
                alreadySubscribed: true
              }, 200, origin, env);
            }
          }
        } else {
          console.log('🟡 [CHECKOUT] Failed to fetch subscriptions, will create new checkout session');
          // Fall through to create new checkout session
        }
      } catch (subsError) {
        console.log('🟡 [CHECKOUT] Error checking subscriptions (non-fatal)', {
          error: subsError?.message || subsError
        });
        // Fall through to create new checkout session
      }
    }

    // Create Checkout Session (subscription) - fallback for new subscriptions or if update failed
    
    // Prepare session body with trial support
    const sessionBody = {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: (env.STRIPE_SUCCESS_URL || `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard.html?paid=1`),
      cancel_url: (env.STRIPE_CANCEL_URL || `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/pricing-a`),
      allow_promotion_codes: 'true',
      payment_method_collection: 'always',
      'metadata[firebaseUid]': uid,
      'metadata[plan]': plan
    };
    
    // Add trial period for trial plan
    if (plan === 'trial') {
      sessionBody['subscription_data[trial_period_days]'] = '3';
      sessionBody['subscription_data[metadata][original_plan]'] = plan;
    }
    
    // Generate a robust idempotency key derived from stable parameters
    const idem = await makeIdemKey(uid, sessionBody);

    console.log('🔵 [CHECKOUT] Creating session', { customerId, priceId, plan });
    try {
      const sessionRes = await stripe(env, '/checkout/sessions', {
        method: 'POST',
        headers: { ...stripeFormHeaders(env), 'Idempotency-Key': idem },
        body: form(sessionBody)
      });
      
      if (!sessionRes.ok) {
        const errorText = await sessionRes.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: { message: errorText || 'Unknown Stripe error' } };
        }
        console.log('🔴 [CHECKOUT] Session create failed', {
          status: sessionRes.status,
          statusText: sessionRes.statusText,
          error: errorData,
          customerId,
          priceId
        });
        const msg = errorData?.error?.message || 'stripe_checkout_error';
        const code = errorData?.error?.type || 'stripe_error';
        const status = (code === 'idempotency_error') ? 409
          : (sessionRes.status >= 400 && sessionRes.status < 500 ? sessionRes.status : 400);
        return json({ ok: false, error: msg, code }, status, origin, env);
      }
      
      const s = await sessionRes.json();
      if (!s || !s.url) {
        console.log('🔴 [CHECKOUT] Invalid session response', s);
        return json({ ok: false, error: 'Invalid response from Stripe' }, 502, origin, env);
      }
      
      // Set has_ever_paid = 1 if creating a paid plan subscription (will be confirmed via webhook)
      // Pre-set it here to prevent race conditions
      const paidPlans = ['essential', 'pro', 'premium'];
      if (paidPlans.includes(plan)) {
        try {
          await updateUserPlan(env, uid, { hasEverPaid: 1 });
          console.log('✅ [CHECKOUT] Pre-set has_ever_paid = 1 for paid plan checkout');
        } catch (paidError) {
          console.log('🟡 [CHECKOUT] Failed to pre-set has_ever_paid (non-fatal)', paidError?.message || paidError);
        }
      }
      
      console.log('✅ [CHECKOUT] Session created', { id: s.id, url: s.url });
      return json({ ok: true, url: s.url, sessionId: s.id }, 200, origin, env);
    } catch (sessionError) {
      console.log('🔴 [CHECKOUT] Session create exception', {
        error: sessionError?.message || sessionError,
        stack: sessionError?.stack?.substring(0, 200),
        name: sessionError?.name
      });
      
      // Check if it's a timeout error
      if (sessionError?.name === 'AbortError' || sessionError?.message?.includes('timeout')) {
        return json({ ok: false, error: 'Request timeout. Please try again.' }, 504, origin, env);
      }
      
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
  // Use AbortController for better compatibility with Cloudflare Workers runtime
  let signal = init?.signal; // Preserve any existing signal
  let timeoutId = null;
  
  try {
    // Only create timeout signal if no signal already exists
    if (!signal && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 15000);
      signal = controller.signal;
    }
  } catch (e) {
    // If AbortController is not available, continue without timeout
    console.log('🟡 [CHECKOUT] AbortController not available, continuing without timeout');
  }
  
  const fetchOptions = { ...init, headers };
  // Only add signal if it's defined, to avoid overriding any signal from init
  if (signal) {
    fetchOptions.signal = signal;
  }
  
  const fetchPromise = fetch(url, fetchOptions);
  
  // Clean up timeout if fetch completes before timeout
  if (timeoutId) {
    fetchPromise.finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }
  
  return fetchPromise;
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
  // Resolve price IDs from multiple possible env var names to avoid mismatches across environments
  const resolve = (base) => (
    env[`STRIPE_PRICE_${base}_MONTHLY`] ||
    env[`PRICE_${base}_MONTHLY`] ||
    env[`STRIPE_PRICE_${base}`] ||
    env[`PRICE_${base}`] ||
    null
  );
  const essential = resolve('ESSENTIAL');
  const pro = resolve('PRO');
  const premium = resolve('PREMIUM');
  const map = {
    trial: essential, // Use Essential price with trial period
    essential: essential,
    pro: pro,
    premium: premium
  };
  return map[plan] || null;
}

// Build a robust Idempotency-Key from stable parameters, so retries succeed
// and parameter changes (e.g., URLs, price, customer, trial period, payment_method_collection) generate a new key
async function makeIdemKey(uid, body) {
  try {
    const enc = new TextEncoder();
    const stable = {
      customer: body.customer,
      price: body['line_items[0][price]'],
      quantity: body['line_items[0][quantity]'],
      mode: body.mode,
      success_url: body.success_url,
      cancel_url: body.cancel_url,
      payment_method_collection: body.payment_method_collection || null,
      metadata: { firebaseUid: body['metadata[firebaseUid]'], plan: body['metadata[plan]'] },
      // Include subscription_data fields to ensure idempotency key changes when trial parameters change
      subscription_data: {
        trial_period_days: body['subscription_data[trial_period_days]'] || null,
        metadata: {
          original_plan: body['subscription_data[metadata][original_plan]'] || null
        }
      }
    };
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify(stable)));
    const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${uid}:${hex.slice(0, 16)}`;
  } catch (_) {
    // Fallback to legacy key if crypto API not available
    return `${uid}:${body['metadata[plan]'] || 'plan'}`;
  }
}


