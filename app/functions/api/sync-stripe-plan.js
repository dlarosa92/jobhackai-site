import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';

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
    console.log('🔄 Sync Stripe plan request received');

    // Verify Firebase auth token
    const token = getBearer(request);
    if (!token) {
      console.log('❌ No authorization token');
      return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    }

    let uid;
    let email;
    try {
      const tokenResult = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
      uid = tokenResult.uid;
      email = tokenResult.payload?.email;
      console.log('✅ Token verified:', { uid, email });
    } catch (tokenError) {
      console.error('❌ Token verification failed:', tokenError);
      return json({ ok: false, error: 'Invalid authentication token' }, 401, origin, env);
    }

    if (!env.JOBHACKAI_KV) {
      throw new Error('JOBHACKAI_KV binding is not configured on this environment');
    }

    // Get customer ID from KV
    let customerId = await env.JOBHACKAI_KV.get(`cusByUid:${uid}`);
    
    // If not in KV, try to find by email (like billing-status does)
    if (!customerId) {
      console.log('🟡 [SYNC-STRIPE-PLAN] No customer in KV, searching by email');
      
      if (email) {
        try {
          const searchRes = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=100`, {
            headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
          });
          
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.data && searchData.data.length > 0) {
              // Find customer with active subscription, or use most recent
              let foundCustomer = null;
              
              if (searchData.data.length > 1) {
                // Check each customer for active subscriptions
                for (const customer of searchData.data) {
                  const subsCheckRes = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=all&limit=10`, {
                    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
                  });
                  if (subsCheckRes.ok) {
                    const subsCheckData = await subsCheckRes.json();
                    if (subsCheckData.data && subsCheckData.data.length > 0) {
                      const hasActive = subsCheckData.data.some(s => 
                        s.status === 'trialing' || s.status === 'active' || s.status === 'past_due'
                      );
                      if (hasActive) {
                        foundCustomer = customer.id;
                        break;
                      }
                    }
                  }
                }
                
                // If no active subscription found, use most recent
                if (!foundCustomer) {
                  foundCustomer = searchData.data.sort((a, b) => b.created - a.created)[0].id;
                }
              } else {
                foundCustomer = searchData.data[0].id;
              }
              
              if (foundCustomer) {
                customerId = foundCustomer;
                // Cache it for next time
                await env.JOBHACKAI_KV.put(`cusByUid:${uid}`, customerId);
                console.log('✅ [SYNC-STRIPE-PLAN] Found customer by email and cached:', customerId);
              }
            }
          }
        } catch (searchError) {
          console.warn('⚠️ [SYNC-STRIPE-PLAN] Email search failed:', searchError);
        }
      }
      
      // If still no customer found, return free plan (not an error)
      if (!customerId) {
        console.log('ℹ️ [SYNC-STRIPE-PLAN] No Stripe customer found - returning free plan');
        await env.JOBHACKAI_KV.put(`planByUid:${uid}`, 'free');
        await env.JOBHACKAI_KV.put(`planTsByUid:${uid}`, String(Math.floor(Date.now() / 1000)));
        return json({ ok: true, plan: 'free', trialEndsAt: null }, 200, origin, env);
      }
    }

    console.log('🔍 Found customer ID:', customerId);

    // Get current subscriptions from Stripe
    const stripeResponse = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=all&limit=10`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });

    if (!stripeResponse.ok) {
      console.error('❌ Stripe API error:', stripeResponse.status);
      return json({ ok: false, error: 'Failed to fetch subscription data' }, 500, origin, env);
    }

    const stripeData = await stripeResponse.json();
    const subscriptions = stripeData.data || [];
    
    console.log('🔍 Found subscriptions:', subscriptions.length);

    if (subscriptions.length === 0) {
      // No active subscriptions, set to free
      await env.JOBHACKAI_KV.put(`planByUid:${uid}`, 'free');
      await env.JOBHACKAI_KV.put(`planTsByUid:${uid}`, String(Math.floor(Date.now() / 1000)));
      return json({ ok: true, plan: 'free', trialEndsAt: null }, 200, origin, env);
    }

    // Get the most recent subscription
    const latestSub = subscriptions[0];
    const status = latestSub.status;
    const items = latestSub.items?.data || [];
    const priceId = items[0]?.price?.id || '';
    const cancelAtPeriodEnd = latestSub.cancel_at_period_end;
    const cancelAt = latestSub.cancel_at;
    const currentPeriodEnd = latestSub.current_period_end;
    const schedule = latestSub.schedule;
    
    console.log('🔍 Latest subscription:', { 
      status, 
      priceId, 
      trialEnd: latestSub.trial_end,
      metadata: latestSub.metadata,
      cancelAtPeriodEnd,
      cancelAt,
      currentPeriodEnd,
      schedule
    });

    let plan = 'free';
    let trialEndsAt = null;

    // Determine plan based on subscription status and metadata
    if (status === 'trialing') {
      // Check if this was originally a trial subscription
      const originalPlan = latestSub.metadata?.plan;
      if (originalPlan === 'trial') {
        plan = 'trial';
        if (latestSub.trial_end) {
          trialEndsAt = new Date(latestSub.trial_end * 1000).toISOString();
          // Store trial end in KV
          await env.JOBHACKAI_KV.put(`trialEndByUid:${uid}`, String(latestSub.trial_end));
        }
      } else {
        // Regular subscription in trial period
        plan = priceToPlan(env, priceId) || 'essential';
      }
    } else if (status === 'active') {
      // Active subscription
      plan = priceToPlan(env, priceId) || 'essential';
    } else if (status === 'past_due' || status === 'unpaid') {
      // Subscription issues, but still has access
      plan = priceToPlan(env, priceId) || 'essential';
    }
    // For cancelled, incomplete, etc., plan stays 'free'

    console.log('✅ Determined plan:', { plan, trialEndsAt });

    // Update KV with correct plan
    const timestamp = Math.floor(Date.now() / 1000);
    const kvKey = `planByUid:${uid}`;
    console.log(`✍️ [SYNC-STRIPE-PLAN] Writing to KV: ${kvKey} = ${plan}`);
    
    try {
      await env.JOBHACKAI_KV.put(kvKey, plan);
      await env.JOBHACKAI_KV.put(`planTsByUid:${uid}`, String(timestamp));
      console.log(`✅ [SYNC-STRIPE-PLAN] KV write completed: ${kvKey} = ${plan}`);
      // Note: We don't verify the write immediately because Cloudflare KV uses eventual
      // consistency. A read immediately after a write may not reflect the written value
      // even if the write succeeded. The write operation will throw if it fails.
    } catch (kvError) {
      console.error(`❌ [SYNC-STRIPE-PLAN] KV write error:`, kvError);
      throw kvError;
    }

    // Store cancellation data if present
    if (cancelAtPeriodEnd && cancelAt) {
      await env.JOBHACKAI_KV.put(`cancelAtByUid:${uid}`, String(cancelAt));
      console.log(`✅ CANCELLATION STORED: cancels at ${new Date(cancelAt * 1000).toISOString()}`);
    } else {
      await env.JOBHACKAI_KV.delete(`cancelAtByUid:${uid}`);
    }

    // Store current period end for renewal display
    if (currentPeriodEnd) {
      await env.JOBHACKAI_KV.put(`periodEndByUid:${uid}`, String(currentPeriodEnd));
    }

    // Fetch and store scheduled plan change if exists
    if (schedule) {
      const schedRes = await fetch(`https://api.stripe.com/v1/subscription_schedules/${schedule}`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
      const schedData = await schedRes.json();
      
      if (schedData && schedData.phases && schedData.phases.length > 1) {
        const nextPhase = schedData.phases[1];
        const nextPriceId = nextPhase.items[0]?.price;
        const nextPlan = priceToPlan(env, nextPriceId);
        const transitionTime = nextPhase.start_date;
        
        if (nextPlan && transitionTime) {
          await env.JOBHACKAI_KV.put(`scheduledPlanByUid:${uid}`, nextPlan);
          await env.JOBHACKAI_KV.put(`scheduledAtByUid:${uid}`, String(transitionTime));
          console.log(`✅ SCHEDULED CHANGE STORED: ${plan} → ${nextPlan} at ${new Date(transitionTime * 1000).toISOString()}`);
        }
      }
    } else {
      await env.JOBHACKAI_KV.delete(`scheduledPlanByUid:${uid}`);
      await env.JOBHACKAI_KV.delete(`scheduledAtByUid:${uid}`);
    }

    return json({ 
      ok: true, 
      plan, 
      trialEndsAt,
      cancelAt: cancelAt ? new Date(cancelAt * 1000).toISOString() : null,
      currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
      subscriptionStatus: status,
      priceId 
    }, 200, origin, env);

  } catch (error) {
    console.error('❌ Error in sync-stripe-plan:', error);
    return json({ ok: false, error: 'Internal server error', details: error.message }, 500, origin, env);
  }
}

function priceToPlan(env, priceId) {
  if (!priceId) return null;
  // Normalize env price IDs across naming variants
  const essential = env.STRIPE_PRICE_ESSENTIAL_MONTHLY || env.PRICE_ESSENTIAL_MONTHLY || env.STRIPE_PRICE_ESSENTIAL || env.PRICE_ESSENTIAL;
  const pro = env.STRIPE_PRICE_PRO_MONTHLY || env.PRICE_PRO_MONTHLY || env.STRIPE_PRICE_PRO || env.PRICE_PRO;
  const premium = env.STRIPE_PRICE_PREMIUM_MONTHLY || env.PRICE_PREMIUM_MONTHLY || env.STRIPE_PRICE_PREMIUM || env.PRICE_PREMIUM;
  // Use if-statements to avoid undefined key collisions in map object
  if (priceId === essential) return 'essential';
  if (priceId === pro) return 'pro';
  if (priceId === premium) return 'premium';
  return null;
}

function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io', 'https://app.jobhackai.io'];
  const configured = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || fallbackOrigins[0]);
  return { 
    'Access-Control-Allow-Origin': allowed, 
    'Access-Control-Allow-Methods': 'POST,OPTIONS', 
    'Access-Control-Allow-Headers': 'Content-Type,Authorization', 
    'Vary': 'Origin', 
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

function json(body, status, origin, env) { 
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin, env) }); 
}
