import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getUserPlanData } from '../_lib/db.js';
import { stripe, priceIdToPlan } from '../_lib/billing-utils.js';

/**
 * GET /api/billing-status
 * Returns the current billing status from Stripe for the authenticated user
 * Response: { ok: true, plan, status, trialEndsAt, currentPeriodEnd, hasPaymentMethod }
 */
export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin, env) });
  }

  try {
    console.log('🔵 [BILLING-STATUS] Request start', {
      method: request.method,
      origin,
      hasAuth: !!request.headers.get('authorization')
    });

    const token = getBearer(request);
    if (!token) {
      console.log('🔴 [BILLING-STATUS] Missing bearer token');
      return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    }

    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const email = (payload?.email) || '';
    console.log('🔵 [BILLING-STATUS] Authenticated', { uid, email });

    // Check cache first (session duration cache - 5 minutes)
    const cacheKey = `billingStatus:${uid}`;
    const cached = force ? null : await env.JOBHACKAI_KV?.get(cacheKey);
    if (force) {
      console.log('🟡 [BILLING-STATUS] Force refresh requested, bypassing cache');
    }
    if (cached) {
      try {
        const cachedData = JSON.parse(cached);
        const cacheAge = Date.now() - cachedData.timestamp;
        // Cache valid for 5 minutes (300000 ms)
        if (cacheAge < 300000) {
          console.log('✅ [BILLING-STATUS] Cache hit', { cacheAge: Math.round(cacheAge / 1000) + 's' });
          return json({ ...cachedData.data, _cached: true }, 200, origin, env);
        }
      } catch (e) {
        console.warn('⚠️ [BILLING-STATUS] Cache parse error, fetching fresh', e);
      }
    }

    // Step 1: Try KV (cache)
    let customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    
    // Step 2: If KV miss, try D1 (authoritative)
    if (!customerId) {
      console.log('🟡 [BILLING-STATUS] No customer found in KV for uid', uid);
      try {
        const userPlan = await getUserPlanData(env, uid);
        if (userPlan?.stripeCustomerId) {
          customerId = userPlan.stripeCustomerId;
          console.log('✅ [BILLING-STATUS] Found customer ID in D1:', customerId);
          // Cache it in KV for next time
          await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
        }
      } catch (d1Error) {
        console.warn('⚠️ [BILLING-STATUS] D1 lookup failed (non-fatal):', d1Error?.message || d1Error);
      }
    }
    
    // Step 3: Only if both KV and D1 miss, fallback to Stripe email search (last resort)
    if (!customerId) {
      console.log('🟡 [BILLING-STATUS] No customer in KV or D1, trying Stripe email search (last resort)');
      // Try to find by email in Stripe as last-resort fallback
      // Get all customers with this email (not just first one) to handle duplicates
      const searchRes = await stripe(env, `/customers?email=${encodeURIComponent(email)}&limit=100`);
      const searchData = await searchRes.json();
      
      if (searchRes.ok && searchData.data && searchData.data.length > 0) {
        console.log('🟡 [BILLING-STATUS] Found', searchData.data.length, 'customers with email', email);

        const emailMatches = searchData.data;
        const uidMatches = emailMatches.filter((c) => c?.metadata?.firebaseUid === uid);
        const candidates = uidMatches.length > 0 ? uidMatches : emailMatches;
        if (uidMatches.length > 0) {
          console.log('🟡 [BILLING-STATUS] Found customers matching firebaseUid', { count: uidMatches.length });
        }

        // If multiple customers exist, find the one with an active subscription
        if (candidates.length > 1) {
          console.log('🟡 [BILLING-STATUS] Multiple customers found, checking subscriptions...');
          
          // Check each customer for active subscriptions
          for (const customer of candidates) {
            // Query all subscriptions and filter for active ones (Stripe status param accepts only single value)
            const subsCheckRes = await stripe(env, `/subscriptions?customer=${customer.id}&status=all&limit=10`);
            const subsCheckData = await subsCheckRes.json();
            
            if (subsCheckRes.ok && subsCheckData.data && subsCheckData.data.length > 0) {
              // Filter for active/trialing/past_due subscriptions
              const hasActive = subsCheckData.data.some(s => 
                s.status === 'trialing' || s.status === 'active' || s.status === 'past_due'
              );
              
              if (hasActive) {
                customerId = customer.id;
                console.log('🟡 [BILLING-STATUS] Found customer with active subscription', customerId);
                break;
              }
            }
          }
          
          // If no customer with active subscription found, use the most recent one
          if (!customerId) {
            customerId = candidates.sort((a, b) => b.created - a.created)[0].id;
            console.log('🟡 [BILLING-STATUS] No active subscriptions found, using most recent customer', customerId);
          }
        } else {
          customerId = candidates[0].id;
          console.log('🟡 [BILLING-STATUS] Found single customer by email', customerId);
        }
        
        // Cache it for next time
        await env.JOBHACKAI_KV?.put(kvCusKey(uid), customerId);
      } else {
        console.log('🟡 [BILLING-STATUS] No Stripe customer exists - returning free plan');
        return json({
          ok: true,
          plan: 'free',
          status: 'none',
          trialEndsAt: null,
          currentPeriodEnd: null,
          hasPaymentMethod: false
        }, 200, origin, env);
      }
    }

    // Get active subscriptions for this customer
    console.log('🔵 [BILLING-STATUS] Fetching subscriptions for customer', customerId);
    const subsRes = await stripe(env, `/subscriptions?customer=${customerId}&status=all&limit=10`);
    const subsData = await subsRes.json();

    if (!subsRes.ok) {
      console.log('🔴 [BILLING-STATUS] Failed to fetch subscriptions', subsData);
      return json({ ok: false, error: 'stripe_error' }, 502, origin, env);
    }

    const subscriptions = subsData.data || [];
    console.log('🔵 [BILLING-STATUS] Found subscriptions', { count: subscriptions.length });

    // Find the most relevant active or trialing subscription
    const activeOrTrialing = subscriptions.filter(s => 
      s.status === 'trialing' || s.status === 'active' || s.status === 'past_due'
    );

    if (activeOrTrialing.length === 0) {
      console.log('🟡 [BILLING-STATUS] No active subscriptions - returning free');
      return json({
        ok: true,
        plan: 'free',
        status: 'none',
        trialEndsAt: null,
        currentPeriodEnd: null,
        hasPaymentMethod: false
      }, 200, origin, env);
    }

    // Get the latest subscription (most recent created_at)
    const latestSub = activeOrTrialing.sort((a, b) => b.created - a.created)[0];
    console.log('🔵 [BILLING-STATUS] Latest subscription', {
      id: latestSub.id,
      status: latestSub.status,
      priceId: latestSub.items?.data?.[0]?.price?.id,
      metadata: latestSub.metadata
    });

    // Determine plan based on subscription status and metadata
    const priceId = latestSub.items?.data?.[0]?.price?.id;
    let plan = 'free';
    
    if (latestSub.status === 'trialing') {
      // Check if this was originally a trial subscription
      const originalPlan = latestSub.metadata?.original_plan || latestSub.metadata?.plan;
      if (originalPlan === 'trial') {
        plan = 'trial';
      } else {
        // Regular subscription in trial period - map from price ID
        plan = priceIdToPlan(env, priceId, { defaultToEssential: true });
      }
    } else if (latestSub.status === 'active' || latestSub.status === 'past_due') {
      // Active subscription - map from price ID
      plan = priceIdToPlan(env, priceId, { defaultToEssential: true });
    }
    
    // Get payment method info - check customer's default payment method
    let hasPaymentMethod = false;
    if (latestSub.default_payment_method) {
      hasPaymentMethod = true;
    } else if (latestSub.customer) {
      // Expand customer to check invoice_settings
      const custRes = await stripe(env, `/customers/${latestSub.customer}`);
      if (custRes.ok) {
        const customer = await custRes.json();
        hasPaymentMethod = !!(customer.invoice_settings?.default_payment_method || customer.default_source);
      }
    }
    
    const result = {
      ok: true,
      plan: plan,
      status: latestSub.status,
      trialEndsAt: latestSub.trial_end ? latestSub.trial_end * 1000 : null,
      currentPeriodEnd: latestSub.current_period_end ? latestSub.current_period_end * 1000 : null,
      hasPaymentMethod: hasPaymentMethod
    };

    // Cache result for 5 minutes (session duration)
    if (env.JOBHACKAI_KV) {
      try {
        await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify({
          data: result,
          timestamp: Date.now()
        }), {
          expirationTtl: 300 // 5 minutes
        });
      } catch (cacheError) {
        console.warn('⚠️ [BILLING-STATUS] Cache write failed (non-fatal):', cacheError);
      }
    }

    console.log('✅ [BILLING-STATUS] Returning status', result);
    return json(result, 200, origin, env);

  } catch (e) {
    console.log('🔴 [BILLING-STATUS] Exception', e?.message || e, e?.stack);
    return json({ ok: false, error: e?.message || 'server_error' }, 500, origin, env);
  }
}

// Helper functions
function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io'];
  const configured = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || 'https://dev.jobhackai.io');
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };
}

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin, env) });
}

const kvCusKey = (uid) => `cusByUid:${uid}`;
