/**
 * Shared billing utility functions
 * Consolidates duplicate functions from upgrade-plan.js, stripe-checkout.js, and billing-status.js
 */

/**
 * Helper function to make Stripe API requests
 * @param {Object} env - Environment variables
 * @param {string} path - Stripe API path (e.g., '/customers')
 * @param {Object} init - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export function stripe(env, path, init) {
  const url = `https://api.stripe.com/v1${path}`;
  const headers = new Headers(init?.headers || {});
  headers.set('Authorization', `Bearer ${env.STRIPE_SECRET_KEY}`);
  return fetch(url, { ...init, headers });
}

/**
 * Convert plan name to Stripe price ID
 * @param {Object} env - Environment variables
 * @param {string} plan - Plan name ('essential', 'pro', 'premium')
 * @returns {string|null} Stripe price ID or null
 */
export function planToPrice(env, plan) {
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
    trial: essential,  // Map trial to Essential price (3-day trial applied via subscription_data)
    essential,
    pro,
    premium
  };
  return map[plan] || null;
}

/**
 * Convert Stripe price ID to plan name
 * @param {Object} env - Environment variables
 * @param {string} priceId - Stripe price ID
 * @param {Object} options - Options object
 * @param {boolean} options.defaultToEssential - If true, provides safe defaults: returns 'free' for null/undefined price IDs, and 'essential' for unknown (non-null) price IDs. If false, returns null for both cases (default: false)
 * @returns {string|null} Plan name ('essential', 'pro', 'premium', 'free', or null)
 */
export function priceIdToPlan(env, priceId, options = {}) {
  const { defaultToEssential = false } = options;

  if (!priceId) {
    return defaultToEssential ? 'free' : null;
  }

  const essential = planToPrice(env, 'essential');
  const pro = planToPrice(env, 'pro');
  const premium = planToPrice(env, 'premium');

  if (priceId === essential) return 'essential';
  if (priceId === pro) return 'pro';
  if (priceId === premium) return 'premium';

  // Unknown price ID
  if (defaultToEssential) {
    console.log('🟡 [BILLING-UTILS] Unknown price ID, defaulting to essential', priceId);
    return 'essential';
  }

  return null;
}

/**
 * Get plan name from a Stripe subscription object
 * @param {Object} sub - Stripe subscription object
 * @param {Object} env - Environment variables
 * @returns {string|null} Plan name or null
 */
export function getPlanFromSubscription(sub, env) {
  if (!sub) return null;

  // Check for trial subscription
  if (sub.status === 'trialing') {
    const originalPlan = sub.metadata?.original_plan || sub.metadata?.plan;
    if (originalPlan === 'trial') return 'trial';
  }

  // Get plan from price ID
  const priceId = sub.items?.data?.[0]?.price?.id;
  return priceIdToPlan(env, priceId) || 'essential';
}

/**
 * List all subscriptions for a Stripe customer
 * @param {Object} env - Environment variables
 * @param {string} customerId - Stripe customer ID
 * @returns {Promise<Array>} Array of subscription objects
 */
export async function listSubscriptions(env, customerId) {
  const res = await stripe(env, `/subscriptions?customer=${customerId}&status=all&limit=25`);
  if (!res.ok) {
    console.log('🟡 [BILLING-UTILS] Subscription list failed', res.status);
    return [];
  }
  const data = await res.json();
  return data?.data || [];
}

/**
 * Get numeric rank for a plan (higher is better)
 * @param {string} plan - Plan name
 * @returns {number} Numeric rank (-1 for unknown)
 */
export function planRank(plan) {
  const ranks = {
    trial: 0,
    essential: 1,
    pro: 2,
    premium: 3
  };
  return ranks[plan] ?? -1;
}

/**
 * Get numeric rank for a subscription status (higher is better)
 * @param {string} status - Subscription status
 * @returns {number} Numeric rank (0 for unknown)
 */
export function statusRank(status) {
  const ranks = {
    active: 3,
    trialing: 2,
    past_due: 1
  };
  return ranks[status] ?? 0;
}

/**
 * Pick the best subscription from a list based on status, plan, and creation date
 * @param {Array} subs - Array of subscription objects
 * @param {Object} env - Environment variables
 * @returns {Object} Object with { bestSub, currentPlan }
 */
export function pickBestSubscription(subs, env) {
  const scored = subs.map((sub) => {
    const plan = getPlanFromSubscription(sub, env);
    return {
      sub,
      plan,
      statusScore: statusRank(sub.status),
      planScore: planRank(plan),
      created: sub.created || 0
    };
  });

  scored.sort((a, b) => {
    if (a.statusScore !== b.statusScore) return b.statusScore - a.statusScore;
    if (a.planScore !== b.planScore) return b.planScore - a.planScore;
    return b.created - a.created;
  });

  if (scored.length > 1) {
    console.log('[BILLING-UTILS] Multiple active subscriptions detected', {
      count: scored.length,
      chosen: scored[0]?.sub?.id
    });
  }

  return {
    bestSub: scored[0].sub,
    currentPlan: scored[0].plan
  };
}
