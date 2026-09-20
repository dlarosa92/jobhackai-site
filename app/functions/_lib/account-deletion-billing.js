import { stripe, kvCusKey } from './billing-utils.js';
import { assertNoCrossUserStripeIds } from './stripe-identity.js';
import { assertStripeKeyMatchesEnvironment, isForeignEnvironmentStamp, canonicalEnvironmentName, canonicalizeEnvironmentStamp } from './stripe-environment.js';

// Never remove the identity on an incomplete billing scan. A bounded scan may
// refuse an unusually large account; it must not treat truncation as success.
async function listAll(env, path) {
  const rows = [];
  const cursors = new Set();
  let cursor = '';
  for (let page = 0; page < 100; page++) {
    const res = await stripe(env, `${path}&limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`);
    if (!res.ok) throw new Error('Billing lookup unavailable');
    const body = await res.json();
    if (!Array.isArray(body.data) || typeof body.has_more !== 'boolean') throw new Error('Incomplete billing lookup');
    rows.push(...body.data);
    if (!body.has_more) return rows;
    cursor = body.data.at(-1)?.id;
    if (!cursor || cursors.has(cursor)) throw new Error('Incomplete billing pagination');
    cursors.add(cursor);
  }
  throw new Error('Billing scan limit reached');
}

const terminal = new Set(['canceled', 'incomplete_expired']);
const knownStatuses = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete', ...terminal]);

/** Verify every candidate before canceling anything, then confirm cancellation
 * before the caller removes Firebase access. Email alone is never ownership. */
export async function cancelBillingBeforeDeletion(env, { uid, user, email }) {
  if (!assertStripeKeyMatchesEnvironment(env).ok) throw new Error('Billing environment configuration invalid');
  const mapped = new Set([user?.stripe_customer_id].filter(Boolean));
  // An unavailable cache might hide an older customer. Fail closed.
  if (typeof env.JOBHACKAI_KV?.get !== 'function') throw new Error('Billing cache unavailable');
  const cached = await env.JOBHACKAI_KV.get(kvCusKey(uid));
  if (cached) mapped.add(cached);
  const customers = new Map();
  for (const id of mapped) {
    const res = await stripe(env, `/customers/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Mapped billing customer unavailable');
    const customer = await res.json();
    if (customer.id !== id) throw new Error('Billing customer mismatch');
    if (customer.deleted !== true) customers.set(id, customer);
  }
  // Include duplicate owned customers and both current and stored email.
  for (const address of new Set([email, user?.email].filter(Boolean))) {
    for (const customer of await listAll(env, `/customers?email=${encodeURIComponent(address)}`)) {
      if (!customer?.id) throw new Error('Invalid billing customer');
      if (customer.deleted !== true) customers.set(customer.id, customer);
    }
  }
  const pending = new Map();
  for (const customer of customers.values()) {
    const owner = customer.metadata?.firebaseUid;
    if (owner && owner !== uid) {
      if (mapped.has(customer.id)) throw new Error('Billing ownership conflict');
      continue; // Another explicitly owned account sharing an email.
    }
    const subscriptions = await listAll(env, `/subscriptions?customer=${encodeURIComponent(customer.id)}&status=all`);
    for (const sub of subscriptions) {
      if (!sub?.id || !knownStatuses.has(sub.status) || (typeof sub.customer === 'string' ? sub.customer : sub.customer?.id) !== customer.id) {
        throw new Error('Invalid billing subscription');
      }
    }
    const live = subscriptions.filter(sub => !terminal.has(sub.status));
    // Dev/QA may share a Stripe account and Firebase identity. Do not delete
    // that identity or cancel billing when another environment owns access.
    for (const sub of live) {
      const stamp = sub.metadata?.environment;
      if (isForeignEnvironmentStamp(env, stamp) ||
          (canonicalEnvironmentName(env) !== 'prod' && !canonicalizeEnvironmentStamp(stamp))) {
        throw new Error('Subscription environment ownership unverified');
      }
    }
    if (owner !== uid) {
      if (mapped.has(customer.id) || live.length) throw new Error('Billing ownership unverified');
      continue;
    }
    if (!(await assertNoCrossUserStripeIds(env, { uid, stripeCustomerId: customer.id })).ok) throw new Error('Billing ownership conflict');
    for (const sub of live) {
      if ((sub.metadata?.firebaseUid && sub.metadata.firebaseUid !== uid) ||
          !(await assertNoCrossUserStripeIds(env, { uid, stripeSubscriptionId: sub.id })).ok) {
        throw new Error('Subscription ownership conflict');
      }
      pending.set(sub.id, sub);
    }
  }
  for (const sub of pending.values()) {
    const res = await stripe(env, `/subscriptions/${encodeURIComponent(sub.id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Subscription cancellation failed');
    const canceled = await res.json();
    const customerId = value => typeof value === 'string' ? value : value?.id;
    if (canceled.id !== sub.id || canceled.status !== 'canceled' || customerId(canceled.customer) !== customerId(sub.customer)) {
      throw new Error('Subscription cancellation unconfirmed');
    }
  }
  return { canceledSubscriptions: pending.size };
}
