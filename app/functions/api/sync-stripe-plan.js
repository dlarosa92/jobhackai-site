import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { updateUserPlan, getUserPlanData } from '../_lib/db.js';

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

    // Step 1: Try KV (cache)
    let customerId = await env.JOBHACKAI_KV.get(`cusByUid:${uid}`);
    
    // Step 2: If KV miss, try D1 (authoritative)
    if (!customerId) {
      console.log('🟡 [SYNC-STRIPE-PLAN] No customer in KV for uid', uid);
      try {
        const userPlan = await getUserPlanData(env, uid);
        if (userPlan?.stripeCustomerId) {
          customerId = userPlan.stripeCustomerId;
          console.log('✅ [SYNC-STRIPE-PLAN] Found customer ID in D1:', customerId);
          // Cache it in KV for next time
          await env.JOBHACKAI_KV.put(`cusByUid:${uid}`, customerId);
        }
      } catch (d1Error) {
        console.warn('⚠️ [SYNC-STRIPE-PLAN] D1 lookup failed (non-fatal):', d1Error?.message || d1Error);
      }
    }
    
    // Step 3: Only if both KV and D1 miss, fallback to Stripe email search (last resort)
    if (!customerId) {
      console.log('🟡 [SYNC-STRIPE-PLAN] No customer in KV or D1, trying Stripe email search (last resort)');
      
      if (email) {
        try {
          const searchRes = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=100`, {
            headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
          });
          
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.data && searchData.data.length > 0) {
              const emailMatches = searchData.data;
              const uidMatches = emailMatches.filter((c) => c?.metadata?.firebaseUid === uid);
              const candidates = uidMatches.length > 0 ? uidMatches : emailMatches;
              if (uidMatches.length > 0) {
                console.log('🟡 [SYNC-STRIPE-PLAN] Found customers matching firebaseUid', { count: uidMatches.length });
              }

              // Find customer with active subscription, or use most recent
              let foundCustomer = null;
              
              if (candidates.length > 1) {
                // Check each customer for active subscriptions
                for (const customer of candidates) {
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
                  foundCustomer = candidates.sort((a, b) => b.created - a.created)[0].id;
                }
              } else {
                foundCustomer = candidates[0].id;
              }
              
              if (foundCustomer) {
                customerId = foundCustomer;
                // Cache it for next time
                await env.JOBHACKAI_KV.put(`cusByUid:${uid}`, customerId);
                console.log('✅ [SYNC-STRIPE-PLAN] Found customer by email (last resort) and cached:', customerId);
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
        await updateUserPlan(env, uid, { plan: 'free' });
        // TEMPORARY: Also write to KV during migration
        await env.JOBHACKAI_KV?.put(`planByUid:${uid}`, 'free');
        return json({ ok: true, plan: 'free', trialEndsAt: null }, 200, origin, env);
      }
    }

    console.log('🔍 Found customer ID:', customerId);

    // Get all subscriptions from Stripe (paginate to avoid missing older paid subs)
    const subscriptions = [];
    let startingAfter = null;
    let hasMore = true;
    let pageCount = 0;
    const maxPages = 20; // Safety cap to avoid runaway loops (up to 2000 subs)
    while (hasMore && pageCount < maxPages) {
      const params = new URLSearchParams({
        customer: customerId,
        status: 'all',
        limit: '100'
      });
      if (startingAfter) params.append('starting_after', startingAfter);

      const stripeResponse = await fetch(`https://api.stripe.com/v1/subscriptions?${params.toString()}`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
      });

      if (!stripeResponse.ok) {
        console.error('❌ Stripe API error:', stripeResponse.status);
        return json({ ok: false, error: 'Failed to fetch subscription data' }, 500, origin, env);
      }

      const stripeData = await stripeResponse.json();
      const pageSubs = stripeData.data || [];
      subscriptions.push(...pageSubs);
      hasMore = stripeData.has_more === true;
      startingAfter = pageSubs.length > 0 ? pageSubs[pageSubs.length - 1].id : null;
      pageCount += 1;

      if (hasMore && !startingAfter) {
        console.warn('⚠️ [SYNC-STRIPE-PLAN] Pagination stopped early due to missing starting_after');
        break;
      }
    }

    if (hasMore) {
      console.warn('⚠️ [SYNC-STRIPE-PLAN] Subscription pagination capped', {
        customerId,
        pagesFetched: pageCount,
        subscriptionsFetched: subscriptions.length
      });
    }
    const everPaidFromStripe = subscriptions.some((sub) => {
      const items = sub?.items?.data || [];
      const priceId = items[0]?.price?.id || '';
      const mappedPlan = priceToPlan(env, priceId);
      return isPaidPlan(mappedPlan);
    });
    
    console.log('🔍 Found subscriptions:', subscriptions.length);

    if (subscriptions.length === 0) {
      // No active subscriptions, set to free
      await updateUserPlan(env, uid, {
        plan: 'free',
        hasEverPaid: everPaidFromStripe ? 1 : undefined
      });
      // TEMPORARY: Also write to KV during migration
      await env.JOBHACKAI_KV?.put(`planByUid:${uid}`, 'free');
      return json({ ok: true, plan: 'free', trialEndsAt: null }, 200, origin, env);
    }

    const activeSubs = subscriptions.filter((sub) =>
      sub && ['active', 'trialing', 'past_due'].includes(sub.status)
    );
    if (activeSubs.length === 0) {
      await updateUserPlan(env, uid, {
        plan: 'free',
        hasEverPaid: everPaidFromStripe ? 1 : undefined
      });
      await env.JOBHACKAI_KV?.put(`planByUid:${uid}`, 'free');
      return json({ ok: true, plan: 'free', trialEndsAt: null }, 200, origin, env);
    }

    // Get the most recent active subscription
    const latestSub = activeSubs.sort((a, b) => b.created - a.created)[0];
    
    // Fetch the full subscription object to ensure we get metadata
    // (list endpoint might not include all fields)
    const fullSubResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${latestSub.id}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    
    let fullSub = latestSub; // Fallback to list result
    if (fullSubResponse.ok) {
      fullSub = await fullSubResponse.json();
      console.log('✅ Fetched full subscription object with metadata:', fullSub.metadata);
    } else {
      console.warn('⚠️ Could not fetch full subscription, using list result');
    }
    
    const status = fullSub.status;
    const items = fullSub.items?.data || [];
    const priceId = items[0]?.price?.id || '';
    const cancelAtPeriodEnd = fullSub.cancel_at_period_end;
    const cancelAt = fullSub.cancel_at;
    const currentPeriodEnd = fullSub.current_period_end;
    const schedule = fullSub.schedule;
    
    console.log('🔍 Latest subscription:', { 
      status, 
      priceId, 
      trialEnd: fullSub.trial_end,
      metadata: fullSub.metadata,
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
      // Check both metadata.plan and metadata.original_plan for trial subscriptions
      const originalPlan = fullSub.metadata?.original_plan || fullSub.metadata?.plan;
      
      // Get what plan the price ID maps to (Essential, Pro, Premium, or null if unknown)
      const priceBasedPlan = priceToPlan(env, priceId);
      
      // Also check if D1 already has 'trial' - but only trust it if:
      // 1. Metadata says it's a trial, OR
      // 2. Price ID doesn't map to a paid plan (meaning it's actually a trial)
      // This prevents D1's stale 'trial' from overriding a real Essential/Pro/Premium subscription
      const existingPlanData = await getUserPlanData(env, uid);
      const existingPlan = existingPlanData?.plan;
      
      // Only trust D1's 'trial' if metadata also suggests trial, OR if price doesn't map to a paid plan
      const isActuallyTrial = originalPlan === 'trial' || 
        (existingPlan === 'trial' && !priceBasedPlan); // Only trust D1 trial if price doesn't map to a plan
      
      if (isActuallyTrial) {
        // This is a trial subscription
        plan = 'trial';
        if (fullSub.trial_end) {
          trialEndsAt = new Date(fullSub.trial_end * 1000).toISOString();
        }
        if (!originalPlan && existingPlan === 'trial') {
          console.log('⚠️ [SYNC-STRIPE-PLAN] Subscription is trialing but metadata not set to trial. D1 has trial and price ID is unknown - keeping trial plan.');
        }
      } else {
        // Regular subscription in trial period (e.g., Essential plan with trial period)
        // Use the price-based plan (Essential, Pro, Premium)
        plan = priceBasedPlan || 'essential';
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

    // Fetch scheduled plan change if exists
    let scheduledPlan = null;
    let scheduledAt = null;
    if (schedule) {
      const schedRes = await fetch(`https://api.stripe.com/v1/subscription_schedules/${schedule}`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
      const schedData = await schedRes.json();
      
      if (schedData && schedData.phases && schedData.phases.length > 1) {
        const nextPhase = schedData.phases[1];
        const nextPriceId = nextPhase.items[0]?.price;
        scheduledPlan = priceToPlan(env, nextPriceId);
        scheduledAt = nextPhase.start_date ? new Date(nextPhase.start_date * 1000).toISOString() : null;
        
        if (scheduledPlan && scheduledAt) {
          console.log(`✅ SCHEDULED CHANGE FOUND: ${plan} → ${scheduledPlan} at ${scheduledAt}`);
        }
      }
    }

    // Update D1 with correct plan (source of truth)
    console.log(`✍️ [SYNC-STRIPE-PLAN] Writing to D1: users.plan = ${plan} for uid=${uid}`);
    
    try {
      await updateUserPlan(env, uid, {
        plan: plan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: fullSub.id,
        subscriptionStatus: status,
        trialEndsAt: trialEndsAt || null, // null clears the field (undefined is skipped)
        currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null, // null clears the field (undefined is skipped)
        cancelAt: (cancelAtPeriodEnd && cancelAt) ? new Date(cancelAt * 1000).toISOString() : null, // null clears the field (undefined is skipped)
        scheduledPlan: scheduledPlan || null, // null clears the field (undefined is skipped)
        scheduledAt: scheduledAt || null, // null clears the field (undefined is skipped)
        hasEverPaid: (isPaidPlan(plan) || everPaidFromStripe) ? 1 : undefined
      });
      console.log(`✅ [SYNC-STRIPE-PLAN] D1 write completed: ${plan}`);
      
      // TEMPORARY: Also write to KV during migration period for safety
      await env.JOBHACKAI_KV?.put(`planByUid:${uid}`, plan);
      if (trialEndsAt) {
        await env.JOBHACKAI_KV?.put(`trialEndByUid:${uid}`, String(fullSub.trial_end));
      }
      if (cancelAtPeriodEnd && cancelAt) {
        await env.JOBHACKAI_KV?.put(`cancelAtByUid:${uid}`, String(cancelAt));
      }
      if (currentPeriodEnd) {
        await env.JOBHACKAI_KV?.put(`periodEndByUid:${uid}`, String(currentPeriodEnd));
      }
      if (scheduledPlan && scheduledAt) {
        await env.JOBHACKAI_KV?.put(`scheduledPlanByUid:${uid}`, scheduledPlan);
        await env.JOBHACKAI_KV?.put(`scheduledAtByUid:${uid}`, String(Math.floor(new Date(scheduledAt).getTime() / 1000)));
      }
    } catch (dbError) {
      console.error(`❌ [SYNC-STRIPE-PLAN] D1 write error:`, dbError);
      throw dbError;
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

function isPaidPlan(plan) {
  return ['essential', 'pro', 'premium'].includes(plan);
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
