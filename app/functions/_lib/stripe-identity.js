// Resolves a Stripe object to exactly one JobHackAI user, and guards D1
// writes so one user's webhook event can never update another user's row.
//
// Resolution priority (strongest provenance first):
//   1. subscription.metadata.firebaseUid — server-set at checkout from a
//      verified Firebase token (stripe-checkout stamps it for all
//      subscription-mode sessions).
//   2. session.metadata.firebaseUid — same provenance; present inside the
//      signed checkout.session.completed event payload itself.
//   3. customer.metadata.firebaseUid — weakest: historically backfilled onto
//      email-matched customers, so it participates but never overrides.
// If two resolved sources disagree, no user is resolved and callers must
// perform no billing mutation.

import { getDb } from './db.js';
import { redactId } from './stripe-environment.js';

// Thrown when Stripe could not be consulted (network, 429, 5xx, auth).
// Webhook callers release their dedup keys and return 503 so Stripe retries.
export class TransientStripeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransientStripeError';
    this.transient = true;
  }
}

function validUidOrNull(value) {
  if (typeof value !== 'string') return null;
  const uid = value.trim();
  if (!uid || uid.length > 128) return null;
  // Firebase UIDs never contain whitespace or control characters.
  if (/\s/.test(uid)) return null;
  for (let i = 0; i < uid.length; i++) {
    const code = uid.charCodeAt(i);
    if (code <= 31 || code === 127) return null;
  }
  return uid;
}

async function fetchCustomerForIdentity(env, customerId) {
  const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  if (!res.ok) {
    // 404 = missing in this mode (or deleted): source exhausted, not an error.
    if (res.status === 404) return { exhausted: true };
    throw new TransientStripeError(`customer fetch failed with status ${res.status}`);
  }
  const customer = await res.json();
  if (!customer || customer.deleted === true) return { exhausted: true };
  return {
    uid: validUidOrNull(customer?.metadata?.firebaseUid),
    email: customer?.email || null
  };
}

/**
 * Resolve the owning Firebase UID for a Stripe event's objects.
 *
 * @returns {{ uid: string|null, source: string|null, email: string|null, conflict: boolean }}
 * @throws {TransientStripeError} when no higher-priority source resolved and
 *         the customer lookup failed transiently (caller should let Stripe retry).
 */
export async function resolveOwnerUid(env, { subscription, session, customerId } = {}) {
  const sources = [];
  const subUid = validUidOrNull(subscription?.metadata?.firebaseUid);
  if (subUid) sources.push({ name: 'subscription', uid: subUid });
  const sessUid = validUidOrNull(session?.metadata?.firebaseUid);
  if (sessUid) sources.push({ name: 'session', uid: sessUid });

  let email = session?.customer_details?.email || null;
  if (customerId) {
    try {
      const cust = await fetchCustomerForIdentity(env, customerId);
      if (!cust.exhausted) {
        if (cust.email) email = cust.email;
        if (cust.uid) sources.push({ name: 'customer', uid: cust.uid });
      }
    } catch (err) {
      if (err instanceof TransientStripeError && sources.length === 0) throw err;
      // A trusted metadata source already resolved the owner; losing the
      // customer cross-check is logged but not fatal.
      console.warn(`[STRIPE-IDENTITY] customer lookup skipped (${err?.message || err}) for ${redactId(customerId)}`);
    }
  }

  const distinctUids = [...new Set(sources.map((s) => s.uid))];
  if (distinctUids.length > 1) {
    console.error(`[STRIPE-IDENTITY] conflicting owner metadata: ${sources.map((s) => `${s.name}=${redactId(s.uid)}`).join(' vs ')}`);
    return { uid: null, source: null, email, conflict: true };
  }
  if (distinctUids.length === 1) {
    return { uid: distinctUids[0], source: sources[0].name, email, conflict: false };
  }
  return { uid: null, source: null, email, conflict: false };
}

/**
 * Refuse to attach a Stripe customer/subscription ID to `uid`'s row when any
 * OTHER user row already holds it. Duplicate IDs in D1 are exactly how the
 * wrong user got updated during the incident; until the data repair runs,
 * hits against legacy duplicates are expected and logged.
 *
 * @returns {{ ok: boolean, conflictRowId?: number }}
 */
export async function assertNoCrossUserStripeIds(env, { uid, stripeCustomerId, stripeSubscriptionId }) {
  if (!uid || (!stripeCustomerId && !stripeSubscriptionId)) return { ok: true };
  const db = getDb(env);
  if (!db) return { ok: true }; // no binding: downstream write fails on its own

  const row = await db.prepare(
    `SELECT id FROM users
     WHERE ((stripe_customer_id IS NOT NULL AND stripe_customer_id = ?1)
        OR (stripe_subscription_id IS NOT NULL AND stripe_subscription_id = ?2))
       AND auth_id != ?3
     LIMIT 1`
  ).bind(stripeCustomerId ?? null, stripeSubscriptionId ?? null, uid).first();

  if (row) {
    console.error(`[STRIPE-IDENTITY] cross-user id conflict: row ${row.id} already holds ${redactId(stripeCustomerId)}/${redactId(stripeSubscriptionId)}; refusing write for ${redactId(uid)}`);
    return { ok: false, conflictRowId: row.id };
  }
  return { ok: true };
}

/**
 * Subscription billing period, tolerant of the Stripe API-version split:
 * pre-Basil versions expose current_period_start/end on the subscription
 * root; 2025-03-31.basil and later expose them per subscription item. No
 * Stripe-Version is pinned anywhere in this codebase, so both shapes occur.
 *
 * Explicit single-item rule (no guessing):
 *   1. Root fields present → use them (pre-Basil shape).
 *   2. Exactly one item → use its period.
 *   3. Multiple items → if `priceToPlan` is provided and exactly one item's
 *      price maps to a known JobHackAI plan, use that item; otherwise the
 *      period is AMBIGUOUS and callers must treat it as a critical failure —
 *      never silently pick the earliest date.
 *
 * @param {object|null} sub - Stripe subscription object
 * @param {{ priceToPlan?: (priceId: string) => string|null }} [opts]
 * @returns {{ currentPeriodStart: string|null, currentPeriodEnd: string|null,
 *             error: null | 'ambiguous_subscription_items' | 'missing_period_item' }}
 *   `error` is null when a period source was unambiguously identified (a null
 *   sub reads as "no subscription": null dates, no error).
 */
export function readSubscriptionPeriod(sub, { priceToPlan } = {}) {
  const toIso = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
  };
  if (!sub || typeof sub !== 'object') {
    return { currentPeriodStart: null, currentPeriodEnd: null, error: null };
  }

  const rootStart = toIso(sub.current_period_start);
  const rootEnd = toIso(sub.current_period_end);
  if (rootStart || rootEnd) return { currentPeriodStart: rootStart, currentPeriodEnd: rootEnd, error: null };

  const items = Array.isArray(sub.items?.data) ? sub.items.data : [];
  let candidates = items;
  if (candidates.length > 1 && typeof priceToPlan === 'function') {
    const planMapped = candidates.filter((item) => {
      try { return Boolean(priceToPlan(item?.price?.id)); } catch { return false; }
    });
    if (planMapped.length === 1) candidates = planMapped;
  }

  if (candidates.length === 1) {
    const start = toIso(candidates[0]?.current_period_start);
    const end = toIso(candidates[0]?.current_period_end);
    if (!start && !end) {
      console.error(`[STRIPE-IDENTITY] subscription item carries no period fields for ${redactId(sub.id)}`);
      return { currentPeriodStart: null, currentPeriodEnd: null, error: 'missing_period_item' };
    }
    return { currentPeriodStart: start, currentPeriodEnd: end, error: null };
  }

  if (candidates.length === 0) {
    console.error(`[STRIPE-IDENTITY] subscription has no items and no root period for ${redactId(sub.id)}`);
    return { currentPeriodStart: null, currentPeriodEnd: null, error: 'missing_period_item' };
  }

  console.error(`[STRIPE-IDENTITY] ${candidates.length} competing subscription items; refusing to guess a period for ${redactId(sub.id)}`);
  return { currentPeriodStart: null, currentPeriodEnd: null, error: 'ambiguous_subscription_items' };
}

/**
 * Ownership-proven customer selection: email matching alone NEVER selects a
 * customer. Only customers whose metadata.firebaseUid exactly equals `uid`
 * are eligible for billing reads/writes on behalf of `uid`. Un-stamped
 * email matches are never adopted and never stamped.
 */
export function selectUidOwnedCustomers(customers, uid) {
  if (!uid) return [];
  return (customers || []).filter((c) => c && c.deleted !== true && c?.metadata?.firebaseUid === uid);
}

/**
 * Partition an email-search result for checkout-time safety decisions:
 *   owned    — provably this user's (exact uid metadata match)
 *   unproven — no uid metadata at all (ownership cannot be established)
 *   foreign  — stamped with a DIFFERENT user's uid (never touch)
 */
export function partitionCustomersByUidClaim(customers, uid) {
  const owned = [];
  const unproven = [];
  const foreign = [];
  for (const c of customers || []) {
    if (!c || c.deleted === true) continue;
    const owner = c?.metadata?.firebaseUid;
    if (owner === uid && uid) owned.push(c);
    else if (!owner) unproven.push(c);
    else foreign.push(c);
  }
  return { owned, unproven, foreign };
}
