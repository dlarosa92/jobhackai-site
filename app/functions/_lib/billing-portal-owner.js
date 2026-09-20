import { getDb } from './db.js';
import { stripe } from './billing-utils.js';
import { assertNoCrossUserStripeIds, selectUidOwnedCustomers } from './stripe-identity.js';
import { canonicalEnvironmentName, canonicalizeEnvironmentStamp, isForeignEnvironmentStamp, resolveExpectedLivemode } from './stripe-environment.js';

export class PortalOwnershipError extends Error {
  constructor() {
    super('Billing ownership could not be verified. Please contact support.');
    this.status = 409;
  }
}

// Portal access grants billing mutations, not just a display of cached data.
// Read every page; an incomplete scan must never authorize that access.
async function listAll(env, path) {
  const rows = [];
  const seen = new Set();
  let cursor = '';
  for (let page = 0; page < 100; page++) {
    const response = await stripe(env, `${path}&limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`);
    if (!response.ok) throw new Error('Billing lookup unavailable');
    const body = await response.json();
    if (!Array.isArray(body.data) || typeof body.has_more !== 'boolean') throw new Error('Incomplete billing lookup');
    rows.push(...body.data);
    if (!body.has_more) return rows;
    cursor = body.data.at(-1)?.id;
    if (!cursor || seen.has(cursor)) throw new Error('Incomplete billing pagination');
    seen.add(cursor);
  }
  throw new Error('Billing scan limit reached');
}

const terminal = new Set(['canceled', 'incomplete_expired']);
const statuses = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete', ...terminal]);

export async function resolvePortalCustomer(env, { uid, email }) {
  const db = getDb(env);
  if (!db) throw new Error('Billing database unavailable');
  // D1 is authoritative. A stale KV customer cannot override this mapping.
  // This path deliberately does not adopt, stamp, cache, or repair identities.
  const user = await db.prepare('SELECT stripe_customer_id, email FROM users WHERE auth_id = ?').bind(uid).first();
  if (!user) return null;
  let customer;
  if (user.stripe_customer_id) {
    const response = await stripe(env, `/customers/${encodeURIComponent(user.stripe_customer_id)}`);
    if (response.status !== 404) {
      if (!response.ok) throw new Error('Billing customer unavailable');
      const body = await response.json();
      if (body.id !== user.stripe_customer_id) throw new PortalOwnershipError();
      if (body.deleted !== true) customer = body;
    }
  }
  if (!customer) {
    const candidates = new Map();
    for (const address of new Set([email, user.email].filter(Boolean))) {
      const matches = await listAll(env, `/customers?email=${encodeURIComponent(address)}`);
      for (const match of selectUidOwnedCustomers(matches, uid)) {
        if (!match.id) throw new PortalOwnershipError();
        candidates.set(match.id, match);
      }
    }
    if (candidates.size > 1) throw new PortalOwnershipError();
    if (!candidates.size) return null;
    // Re-read a search match; an email result is not a fresh ownership check.
    const id = candidates.keys().next().value;
    const response = await stripe(env, `/customers/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('Billing customer unavailable');
    customer = await response.json();
    if (customer.id !== id || customer.deleted === true) throw new PortalOwnershipError();
  }
  if (customer.metadata?.firebaseUid !== uid || customer.livemode !== resolveExpectedLivemode(env).expected ||
      !(await assertNoCrossUserStripeIds(env, { uid, stripeCustomerId: customer.id })).ok) {
    throw new PortalOwnershipError();
  }
  // Dev and QA currently share a Stripe account. A full customer portal can
  // change every subscription, so reject mixed or unproven active ownership.
  for (const sub of await listAll(env, `/subscriptions?customer=${encodeURIComponent(customer.id)}&status=all`)) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    if (!sub.id || customerId !== customer.id || !statuses.has(sub.status) ||
        (sub.metadata?.firebaseUid && sub.metadata.firebaseUid !== uid) ||
        !(await assertNoCrossUserStripeIds(env, { uid, stripeSubscriptionId: sub.id })).ok) {
      throw new PortalOwnershipError();
    }
    if (!terminal.has(sub.status) && (isForeignEnvironmentStamp(env, sub.metadata?.environment) ||
        (canonicalEnvironmentName(env) !== 'prod' && !canonicalizeEnvironmentStamp(sub.metadata?.environment)))) {
      throw new PortalOwnershipError();
    }
  }
  return customer.id;
}
