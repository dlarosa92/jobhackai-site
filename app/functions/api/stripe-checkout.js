import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { isTrialEligible, getUserPlanData, updateUserPlan } from '../_lib/db.js';
import {
  planToPrice,
  priceIdToPlan,
  getPlanFromSubscription,
  listSubscriptions,
  validateStripeCustomer,
  clearCustomerReferences,
  kvCusKey
} from '../_lib/billing-utils.js';
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

    // Prevent multiple trials per user - check D1 (source of truth)
    if (plan === 'trial') {
      try {
        const eligible = await isTrialEligible(env, uid);
        if (!eligible) {
          console.log('🔴 [CHECKOUT] Trial not eligible for user', uid);
          return json({
            ok: false,
            error: 'Trial already used. Please select a paid plan.',
            code: 'trial_not_available'
          }, 400, origin, env);
        }
      } catch (dbError) {
        console.log('🔴 [CHECKOUT] D1 error for trial eligibility check', dbError?.message || dbError);
        // Fail closed for safety
        return json({
          ok: false,
          error: 'Unable to verify trial eligibility. Please contact support.',
          code: 'trial_check_failed'
        }, 500, origin, env);
      }
    }

    const priceId = planToPrice(env, plan);
    console.log('🔵 [CHECKOUT] Plan→Price', { plan, priceId, envKeys: Object.keys(env).filter(k => k.includes('PRICE_')) });
    if (!priceId) {
      console.log('🔴 [CHECKOUT] Invalid plan', { plan });
      return json({ ok: false, error: 'Invalid plan' }, 400, origin, env);
    }

    // Step 1: Try KV (cache)
    let customerId = null;
    try {
      customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    } catch (kvError) {
      console.log('🟡 [CHECKOUT] KV read error (non-fatal)', kvError?.message || kvError);
    }
    
    // Step 2: If KV miss, try D1 (authoritative)
    if (!customerId) {
      console.log('🟡 [CHECKOUT] No customer in KV for uid', uid);
      try {
        const userPlan = await getUserPlanData(env, uid);
        if (userPlan?.stripeCustomerId) {
          customerId = userPlan.stripeCustomerId;
          console.log('✅ [CHECKOUT] Found customer ID in D1:', customerId);
          // Cache it in KV for next time
          try {
            await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
          } catch (kvWriteError) {
            console.log('🟡 [CHECKOUT] KV cache write error (non-fatal)', kvWriteError?.message || kvWriteError);
          }
        }
      } catch (d1Error) {
        console.warn('⚠️ [CHECKOUT] D1 lookup failed (non-fatal):', d1Error?.message || d1Error);
      }
    }
    
    let matchedCustomer = null;

    // Step 2.5: Validate stored customer still exists in Stripe.
    // If stale, clear cached IDs so fallback can recover in the same request.
    if (customerId) {
      const validation = await validateStripeCustomer(env, customerId);
      if (!validation.valid) {
        console.log('🟡 [CHECKOUT] Stored customer is stale in Stripe. Clearing stale customer ID.', {
          uid,
          customerId,
          reason: validation.reason
        });
        await clearCustomerReferences(env, uid);
        customerId = null;
        matchedCustomer = null;
      }
    }

    // Step 3: Only if both KV and D1 miss (or stale IDs are cleared), fallback to Stripe email search.
    if (!customerId && email) {
      try {
        const searchRes = await stripe(env, `/customers?email=${encodeURIComponent(email)}&limit=100`);
        const searchData = await searchRes.json();
        const customers = searchRes.ok
          ? (searchData?.data || []).filter((c) => c && c.deleted !== true)
          : [];
        if (customers.length > 0) {
          const uidMatches = customers.filter((c) => c?.metadata?.firebaseUid === uid);
          const candidates = uidMatches.length > 0 ? uidMatches : customers;
          if (uidMatches.length > 0) {
            console.log('🟡 [CHECKOUT] Found customers matching firebaseUid', { count: uidMatches.length });
          }

          if (candidates.length > 1) {
            for (const candidate of candidates) {
              const subsCheckRes = await stripe(env, `/subscriptions?customer=${candidate.id}&status=all&limit=10`);
              if (subsCheckRes.ok) {
                const subsCheckData = await subsCheckRes.json();
                const hasActive = (subsCheckData?.data || []).some((s) =>
                  s && ['active', 'trialing', 'past_due'].includes(s.status)
                );
                if (hasActive) {
                  matchedCustomer = candidate;
                  break;
                }
              }
            }
            if (!matchedCustomer) {
              matchedCustomer = candidates.sort((a, b) => b.created - a.created)[0];
            }
          } else {
            matchedCustomer = candidates[0];
          }

          if (matchedCustomer?.id) {
            customerId = matchedCustomer.id;
            console.log('✅ [CHECKOUT] Found customer by email fallback', customerId);
          }
        }
      } catch (searchError) {
        console.log('🟡 [CHECKOUT] Email fallback failed (non-fatal)', searchError?.message || searchError);
      }
    }

    // Step 4: Only create new Stripe customer if all lookups are missing
    if (!customerId) {
      console.log('🔵 [CHECKOUT] Creating new Stripe customer for uid', uid);
      try {
        const res = await stripe(env, '/customers', {
          method: 'POST',
          headers: { ...stripeFormHeaders(env), 'Idempotency-Key': `cust:${uid}` },
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
          return json({ ok: false, error: 'Invalid response from Stripe' }, 500, origin, env);
        }
        
        customerId = c.id;
        matchedCustomer = c;
        
        // Try to cache customer ID (non-blocking)
        try {
          await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
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

    if (customerId) {
      try {
        await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
      } catch (_) {}
      try {
        await updateUserPlan(env, uid, { stripeCustomerId: customerId });
      } catch (_) {}

      if (matchedCustomer && !matchedCustomer?.metadata?.firebaseUid) {
        try {
          await stripe(env, `/customers/${customerId}`, {
            method: 'POST',
            headers: stripeFormHeaders(env),
            body: form({ 'metadata[firebaseUid]': uid })
          });
        } catch (e) {
          console.log('🟡 [CHECKOUT] Failed to backfill customer metadata', e?.message || e);
        }
      }
    }

    // Guard against duplicate subscriptions for paid plans.
    const subs = await listSubscriptions(env, customerId);
    const activeSubs = subs.filter((sub) =>
      sub && ['active', 'trialing', 'past_due'].includes(sub.status)
    );
    if (activeSubs.length > 0) {
      const currentPlan = getPlanFromSubscription(activeSubs[0], env);
      console.log('🟡 [CHECKOUT] Active subscription exists, blocking checkout', {
        uid,
        customerId,
        currentPlan
      });
      return json({
        ok: false,
        error: 'Already subscribed. Manage your plan in Billing Management.',
        code: 'ALREADY_SUBSCRIBED',
        plan: currentPlan
      }, 409, origin, env);
    }

    // Create Checkout Session (subscription)
    
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
    
    // Generate idempotency key (forceNew for fresh session if requested from frontend)
    const forceNew = !!body.forceNew;
    let idem;
    if (forceNew) {
      try {
        idem = `${uid}:${crypto.randomUUID()}`;
      } catch (e) {
        idem = `${uid}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;
      }
    } else {
      idem = await makeIdemKey(uid, sessionBody);
    }

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
        return json({ ok: false, error: 'Invalid response from Stripe' }, 500, origin, env);
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
