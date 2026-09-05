// Ownership-safe customer resolution and checkout-session construction,
// shared by stripe-checkout.js and upgrade-plan.js and unit-tested in bare
// Node (this module's import chain deliberately avoids firebase-auth/jose).

import { stripe } from './billing-utils.js';
import { partitionCustomersByUidClaim } from './stripe-identity.js';
import { redactId } from './stripe-environment.js';

// Subscription statuses that still represent (or may recover into) paid
// entitlement. Includes 'unpaid': the webhook keeps the plan through
// unpaid dunning, so a customer stuck in 'unpaid' is still a double-billing
// risk at checkout and must trip the block below.
export const ENTITLED_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

// Email-search customer resolution for checkout.
//
// Rules (hotfix R2-5 + PR #851 review round):
//   * Email matching alone never selects a customer — only exact
//     metadata.firebaseUid matches are eligible; un-stamped matches are
//     never adopted and never stamped.
//   * Un-stamped customers with an active/trialing/past_due/unpaid subscription
//     block checkout REGARDLESS of whether an owned customer also exists:
//     the later duplicate-subscription guard inspects only the selected
//     customer, so proceeding here could create a second subscription for
//     someone already paying on the un-stamped one.
//   * Unverifiable states fail closed (retryable 503).
//
// Returns { block: { status, code, error } } to abort the request, or
// { matchedCustomer } (null → caller creates a fresh, stamped customer).
export async function resolveCustomerByEmailOwnership(env, uid, email) {
  let customers;
  try {
    const searchRes = await stripe(env, `/customers?email=${encodeURIComponent(email)}&limit=100`);
    if (!searchRes.ok) throw new Error(`customer search returned ${searchRes.status}`);
    const searchData = await searchRes.json();
    customers = (searchData?.data || []).filter((c) => c && c.deleted !== true);
  } catch (searchError) {
    // Fail closed: without the search we cannot rule out an existing active
    // subscription under this email, and creating a second customer could
    // double-bill. Retryable.
    console.error('🔴 [CHECKOUT] Email ownership check failed, blocking checkout:', searchError?.message || searchError);
    return { block: {
      status: 503,
      code: 'OWNERSHIP_CHECK_UNAVAILABLE',
      error: 'Unable to verify billing ownership. Please try again in a moment.'
    } };
  }

  const { owned, unproven } = partitionCustomersByUidClaim(customers, uid);

  // The un-stamped active-subscription check runs FIRST and unconditionally
  // — never only in the no-owned-match branch — and over EVERY un-stamped
  // match (the search returns up to 100): skipping any of them would let an
  // entitled subscription slip past this guard.
  for (const candidate of unproven) {
    let hasActive = false;
    try {
      const subsCheckRes = await stripe(env, `/subscriptions?customer=${candidate.id}&status=all&limit=10`);
      if (!subsCheckRes.ok) throw new Error(`subscription check returned ${subsCheckRes.status}`);
      const subsCheckData = await subsCheckRes.json();
      hasActive = (subsCheckData?.data || []).some((s) =>
        s && ENTITLED_SUBSCRIPTION_STATUSES.includes(s.status)
      );
    } catch (subsCheckErr) {
      console.error('🔴 [CHECKOUT] Could not verify un-stamped customer, blocking checkout:', subsCheckErr?.message || subsCheckErr);
      return { block: {
        status: 503,
        code: 'OWNERSHIP_CHECK_UNAVAILABLE',
        error: 'Unable to verify billing ownership. Please try again in a moment.'
      } };
    }
    if (hasActive) {
      console.error(`🔴 [CHECKOUT] Un-stamped customer ${redactId(candidate.id)} under this email has an active subscription; blocking checkout (support required)`);
      return { block: {
        status: 409,
        code: 'EXISTING_SUBSCRIPTION_UNVERIFIED',
        error: 'An existing subscription is associated with this email but cannot be verified automatically. Please contact support.'
      } };
    }
  }

  if (owned.length === 0) {
    if (unproven.length > 0) {
      console.log('🟡 [CHECKOUT] Email matches exist but none are uid-owned and none have active subscriptions; creating a fresh customer');
    }
    return { matchedCustomer: null };
  }

  console.log('🟡 [CHECKOUT] Found customers matching firebaseUid', { count: owned.length });
  let matchedCustomer = null;
  if (owned.length > 1) {
    // All candidates are provably this user's; prefer the one with an
    // active subscription, else the newest.
    for (const candidate of owned) {
      const subsCheckRes = await stripe(env, `/subscriptions?customer=${candidate.id}&status=all&limit=10`);
      if (subsCheckRes.ok) {
        const subsCheckData = await subsCheckRes.json();
        const hasActive = (subsCheckData?.data || []).some((s) =>
          s && ENTITLED_SUBSCRIPTION_STATUSES.includes(s.status)
        );
        if (hasActive) {
          matchedCustomer = candidate;
          break;
        }
      }
    }
    if (!matchedCustomer) {
      matchedCustomer = [...owned].sort((a, b) => b.created - a.created)[0];
    }
  } else {
    matchedCustomer = owned[0];
  }
  return { matchedCustomer };
}

// Checkout-session body for upgrade-plan's no-active-subscription path.
// Mirrors stripe-checkout: the subscription itself must carry
// metadata[firebaseUid] (the strongest ownership source), not just the
// session — otherwise customer.subscription.* events from this session can
// only resolve via customer metadata, which legacy KV/D1-mapped customers
// may lack.
export function buildUpgradeCheckoutSessionBody(env, { uid, customerId, priceId, targetPlan, returnUrl, source }) {
  return {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    success_url: returnUrl,
    cancel_url: returnUrl,
    allow_promotion_codes: 'true',
    payment_method_collection: 'always',
    'metadata[firebaseUid]': uid,
    'metadata[plan]': targetPlan,
    'metadata[upgrade_source]': source,
    'subscription_data[metadata][firebaseUid]': uid
  };
}
