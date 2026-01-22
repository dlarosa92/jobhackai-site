import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth';
import { stripe, priceIdToPlan } from '../_lib/billing-utils.js';

/**
 * GET /api/billing-status
 * Returns the current billing status from Stripe for the authenticated user
 * Response: { ok: true, plan, status, trialEndsAt, currentPeriodEnd, hasPaymentMethod }
 */
export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

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

    // Get Stripe customer ID from KV
    let customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    
    if (!customerId) {
      console.log('🟡 [BILLING-STATUS] No customer found in KV for uid', uid);
      // Try to find by email in Stripe as fallback
      // Get all customers with this email (not just first one) to handle duplicates
      const searchRes = await stripe(env, `/customers?email=${encodeURIComponent(email)}&limit=100`);
      const searchData = await searchRes.json();
      
      if (searchRes.ok && searchData.data && searchData.data.length > 0) {
        console.log('🟡 [BILLING-STATUS] Found', searchData.data.length, 'customers with email', email);
        
        // If multiple customers exist, find the one with an active subscription
        if (searchData.data.length > 1) {
          console.log('🟡 [BILLING-STATUS] Multiple customers found, checking subscriptions...');
          
          // Check each customer for active subscriptions
          for (const customer of searchData.data) {
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
            customerId = searchData.data.sort((a, b) => b.created - a.created)[0].id;
            console.log('🟡 [BILLING-STATUS] No active subscriptions found, using most recent customer', customerId);
          }
        } else {
          customerId = searchData.data[0].id;
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
        plan = priceIdToPlan(env, priceId, { defaultToFree: true });
      }
    } else if (latestSub.status === 'active' || latestSub.status === 'past_due') {
      // Active subscription - map from price ID
      plan = priceIdToPlan(env, priceId, { defaultToFree: true });
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

    console.log('✅ [BILLING-STATUS] Returning status', result);
    return json(result, 200, origin, env);

  } catch (e) {
    console.log('🔴 [BILLING-STATUS] Exception', e?.message || e, e?.stack);
    return json({ ok: false, error: e?.message || 'server_error' }, 500, origin, env);
  }
}

// Helper functions
function corsHeaders(origin, env) {
  const expected = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : 'https://dev.jobhackai.io';
  const allowed = origin === expected ? origin : expected;
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

