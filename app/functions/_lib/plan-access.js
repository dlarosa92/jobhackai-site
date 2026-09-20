/**
 * Shared plan constants for the repositioned business model.
 *
 * Repositioning (docs/jobhackai-repositioning-brief.md):
 * - The prep tools (interview questions, resume feedback/rewrite, cover letter,
 *   typed mock interview, linkedin optimizer) are FREE for every signed-in user.
 * - The only paid product is the Voice Mock Interview, sold as:
 *     weekly  ($17/wk subscription)
 *     monthly ($34/mo subscription)
 *     pack    ($39 one-time, 5 sessions, 90-day expiry)
 * - Legacy plans (trial/essential/pro/premium) are grandfathered: an active
 *   legacy subscription is treated as monthly with unlimited voice sessions.
 */

export const LEGACY_PAID_PLANS = ['essential', 'pro', 'premium'];
export const VOICE_SUBSCRIPTION_PLANS = ['weekly', 'monthly'];
export const ALL_PAID_PLANS = [...LEGACY_PAID_PLANS, ...VOICE_SUBSCRIPTION_PLANS];

// Every plan value a signed-in user can have. Tool endpoints that are free
// with signup should gate on this list (auth is still required).
export const SIGNED_IN_PLANS = ['free', 'trial', 'pack', ...ALL_PAID_PLANS];

// Plans that represent a live Stripe subscription (for billing UI access).
export const SUBSCRIPTION_PLANS = ['trial', ...ALL_PAID_PLANS];

export function isSignedInPlan(plan) {
  return SIGNED_IN_PLANS.includes(plan);
}
