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
const objectId = value => typeof value === 'string' ? value : value?.id;
const paymentStates = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded']);

// Checkout expiration can race with payment completion. A successful POST alone
// is not a settlement proof: rescan sessions, payments and subscriptions before
// allowing the caller to remove identity. This still needs admission coordination
// at every writer; scans cannot prevent a new request after the final read.
async function inspectCheckouts(env, customer, uid, { allowOpen }) {
  const open = [];
  const expirablePayments = new Set();
  const sessions = await listAll(env, `/checkout/sessions?customer=${encodeURIComponent(customer.id)}`);
  for (const session of sessions) {
    if (!session?.id || objectId(session.customer) !== customer.id ||
        !['open', 'complete', 'expired'].includes(session.status) ||
        !['paid', 'unpaid', 'no_payment_required'].includes(session.payment_status)) {
      throw new Error('Invalid billing checkout');
    }
    if (session.status === 'complete' && session.payment_status === 'unpaid') {
      throw new Error('Checkout payment remains unsettled');
    }
    if (session.status !== 'open') continue;
    if (!allowOpen) throw new Error('Checkout remains open');
    if (customer.metadata?.firebaseUid !== uid || session.metadata?.firebaseUid !== uid ||
        (session.client_reference_id && session.client_reference_id !== uid) ||
        !['payment', 'subscription'].includes(session.mode) || session.payment_status !== 'unpaid' ||
        isForeignEnvironmentStamp(env, session.metadata?.environment) ||
        (canonicalEnvironmentName(env) !== 'prod' && !canonicalizeEnvironmentStamp(session.metadata?.environment))) {
      throw new Error('Checkout ownership or state unverified');
    }
    open.push(session);
    if (objectId(session.payment_intent)) expirablePayments.add(objectId(session.payment_intent));
  }
  for (const payment of await listAll(env, `/payment_intents?customer=${encodeURIComponent(customer.id)}`)) {
    if (!payment?.id || objectId(payment.customer) !== customer.id || !paymentStates.has(payment.status)) {
      throw new Error('Invalid billing payment');
    }
    if (['succeeded', 'canceled'].includes(payment.status)) continue;
    // Do not cancel a pending charge. Only a not-yet-started payment attached to
    // an explicitly owned open Checkout may resolve through session expiration.
    if (!allowOpen || payment.status !== 'requires_payment_method' || !expirablePayments.has(payment.id) ||
        (payment.metadata?.firebaseUid && payment.metadata.firebaseUid !== uid) ||
        isForeignEnvironmentStamp(env, payment.metadata?.environment)) {
      throw new Error('Payment remains unsettled');
    }
  }
  return open;
}

async function inspectSubscriptions(env, customer, uid) {
  const subscriptions = await listAll(env, `/subscriptions?customer=${encodeURIComponent(customer.id)}&status=all`);
  for (const sub of subscriptions) {
    if (!sub?.id || !knownStatuses.has(sub.status) || objectId(sub.customer) !== customer.id) {
      throw new Error('Invalid billing subscription');
    }
  }
  const live = subscriptions.filter(sub => !terminal.has(sub.status));
  for (const sub of live) {
    const stamp = sub.metadata?.environment;
    if (isForeignEnvironmentStamp(env, stamp) ||
        (canonicalEnvironmentName(env) !== 'prod' && !canonicalizeEnvironmentStamp(stamp))) {
      throw new Error('Subscription environment ownership unverified');
    }
    if (customer.metadata?.firebaseUid !== uid ||
        (sub.metadata?.firebaseUid && sub.metadata.firebaseUid !== uid) ||
        !(await assertNoCrossUserStripeIds(env, { uid, stripeSubscriptionId: sub.id })).ok) {
      throw new Error('Subscription ownership conflict');
    }
  }
  return live;
}

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
  const ownedCustomers = [];
  const openCheckouts = new Map();
  for (const customer of customers.values()) {
    const owner = customer.metadata?.firebaseUid;
    if (owner && owner !== uid) {
      if (mapped.has(customer.id)) throw new Error('Billing ownership conflict');
      continue; // Another explicitly owned account sharing an email.
    }
    const live = await inspectSubscriptions(env, customer, uid);
    const sessions = await inspectCheckouts(env, customer, uid, { allowOpen: true });
    if (owner !== uid) {
      if (mapped.has(customer.id) || live.length) throw new Error('Billing ownership unverified');
      continue;
    }
    if (!(await assertNoCrossUserStripeIds(env, { uid, stripeCustomerId: customer.id })).ok) throw new Error('Billing ownership conflict');
    ownedCustomers.push(customer);
    for (const session of sessions) openCheckouts.set(session.id, session);
  }
  // Every candidate is validated before the first external mutation.
  for (const session of openCheckouts.values()) {
    const res = await stripe(env, `/checkout/sessions/${encodeURIComponent(session.id)}/expire`, { method: 'POST' });
    if (!res.ok) throw new Error('Checkout expiration unconfirmed');
    const expired = await res.json();
    if (expired.id !== session.id || expired.status !== 'expired' || objectId(expired.customer) !== objectId(session.customer)) {
      throw new Error('Checkout expiration unconfirmed');
    }
  }
  const pending = new Map();
  for (const customer of ownedCustomers) {
    await inspectCheckouts(env, customer, uid, { allowOpen: false });
    for (const sub of await inspectSubscriptions(env, customer, uid)) pending.set(sub.id, sub);
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
  // A timeout or an outstanding payment after cancellation is still a failure;
  // the caller must preserve sign-in and report possible partial cancellation.
  for (const customer of ownedCustomers) {
    await inspectCheckouts(env, customer, uid, { allowOpen: false });
    if ((await inspectSubscriptions(env, customer, uid)).length) throw new Error('Billing cancellation remains unsettled');
  }
  return { canceledSubscriptions: pending.size, expiredCheckouts: openCheckouts.size };
}
