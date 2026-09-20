// Financial evidence only. No GA requests, generated browser IDs, list prices,
// inferred purchases from plan changes, or consent/campaign assumptions.
import { getDb } from './db.js';
import { paymentAttributionStatement } from './payment-attribution.js';
import { canonicalEnvironmentName, canonicalizeEnvironmentStamp, resolveExpectedLivemode } from './stripe-environment.js';

export const REVENUE_EVENTS = new Set([
  'charge.succeeded', 'charge.captured', 'charge.refunded',
  'refund.created', 'refund.updated', 'refund.failed'
]);
const id = (value) => typeof value === 'string' ? value : value?.id;
const positiveInt = (value) => Number.isSafeInteger(value) && value > 0;
const fail = (reason) => { throw new Error(`revenue_${reason}`); };
const objectId = (value, prefix) => {
  const result = id(value);
  if (typeof result !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(result)) fail('invalid_id');
  return result;
};

async function readStripe(env, path) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2025-03-31.basil' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) fail(`stripe_read_${response.status}`);
  return response.json();
}

// Bind money to the checkout/subscription that created it, not a shared Stripe
// customer (dev and QA currently share test-mode customers). Missing or
// ambiguous context is retryable and visible; never guess an environment.
async function chargeContext(env, charge) {
  const paymentIntentId = objectId(charge.payment_intent, 'pi');
  const sessions = await readStripe(env, `/checkout/sessions?payment_intent=${paymentIntentId}&limit=2`);
  if (!Array.isArray(sessions.data) || sessions.has_more || sessions.data.length > 1) fail('ambiguous_checkout');
  const checkout = sessions.data[0];
  if (checkout) {
    const session = sessions.data[0];
    if (!['payment', 'subscription'].includes(session.mode) || session.status !== 'complete' || session.payment_status !== 'paid') fail('checkout_not_settled');
    if (id(session.customer) !== id(charge.customer) || id(session.payment_intent) !== paymentIntentId) fail('checkout_mismatch');
    if (session.mode === 'payment') {
      return { stamp: session.metadata?.environment, customerId: objectId(session.customer, 'cus'),
        sessionId: objectId(session.id, 'cs'), invoiceId: null, subscriptionId: null };
    }
  }
  const payments = await readStripe(env, `/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=${paymentIntentId}&limit=100`);
  if (!Array.isArray(payments.data) || payments.has_more) fail('ambiguous_invoice_payments');
  const paid = payments.data.filter((p) => p.status === 'paid');
  const invoiceIds = [...new Set(paid.map((p) => objectId(p.invoice, 'in')))];
  // Allocations of one payment across several invoices require an explicit
  // allocation model. Do not label all of that charge as one subscription.
  if (invoiceIds.length !== 1) fail('invoice_context_unresolved');
  if (paid.some((p) => id(p.payment?.payment_intent) !== paymentIntentId)) fail('invoice_payment_mismatch');
  const invoice = await readStripe(env, `/invoices/${invoiceIds[0]}`);
  const details = invoice.parent?.subscription_details || invoice.subscription_details;
  const subscriptionId = objectId(details?.subscription || invoice.subscription, 'sub');
  if (checkout && id(checkout.subscription) !== subscriptionId) fail('checkout_subscription_mismatch');
  const subscription = await readStripe(env, `/subscriptions/${subscriptionId}`);
  if (id(invoice.customer) !== id(charge.customer) || id(subscription.customer) !== id(charge.customer)) fail('invoice_customer_mismatch');
  const stamps = [checkout?.metadata?.environment, details?.metadata?.environment, subscription.metadata?.environment]
    .map(canonicalizeEnvironmentStamp).filter(Boolean);
  if (new Set(stamps).size > 1) fail('invoice_environment_conflict');
  return { stamp: stamps[0], customerId: objectId(charge.customer, 'cus'),
    sessionId: null, invoiceId: invoiceIds[0], subscriptionId };
}

export function paymentStatement(db, charge, context, event, environment) {
  if (!positiveInt(charge.amount_captured) || !positiveInt(charge.created) || !/^[a-z]{3}$/.test(charge.currency || '')) fail('invalid_charge_amount');
  return db.prepare(`INSERT INTO stripe_collected_payments
    (charge_id, payment_intent_id, customer_id, checkout_session_id, invoice_id, subscription_id,
     environment, livemode, currency, amount_captured, charge_created_at, first_event_id, last_event_id)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
    ON CONFLICT(charge_id) DO UPDATE SET
      amount_captured = CASE WHEN stripe_collected_payments.currency = excluded.currency
        AND stripe_collected_payments.environment = excluded.environment
        AND stripe_collected_payments.livemode = excluded.livemode
        AND stripe_collected_payments.customer_id = excluded.customer_id
        AND stripe_collected_payments.payment_intent_id = excluded.payment_intent_id
        AND stripe_collected_payments.checkout_session_id IS excluded.checkout_session_id
        AND stripe_collected_payments.invoice_id IS excluded.invoice_id
        AND stripe_collected_payments.subscription_id IS excluded.subscription_id
        THEN MAX(stripe_collected_payments.amount_captured, excluded.amount_captured) ELSE NULL END,
      last_event_id = excluded.last_event_id, refreshed_at = datetime('now')`)
    .bind(objectId(charge.id, 'ch'), objectId(charge.payment_intent, 'pi'), context.customerId,
      context.sessionId, context.invoiceId, context.subscriptionId, environment,
      charge.livemode ? 1 : 0, charge.currency, charge.amount_captured, charge.created, event.id);
}

export function refundStatement(db, refund, charge, event) {
  if (!positiveInt(refund.amount) || refund.amount > charge.amount_captured || !positiveInt(refund.created)
    || refund.currency !== charge.currency || id(refund.charge) !== charge.id) fail('invalid_refund');
  return db.prepare(`INSERT INTO stripe_payment_refunds
    (refund_id, charge_id, currency, amount, status, refund_created_at, last_event_id)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(refund_id) DO UPDATE SET
      amount = CASE WHEN stripe_payment_refunds.charge_id = excluded.charge_id
        AND stripe_payment_refunds.currency = excluded.currency AND stripe_payment_refunds.amount = excluded.amount
        THEN excluded.amount ELSE NULL END,
      status = CASE
        WHEN stripe_payment_refunds.status IN ('failed', 'canceled') THEN stripe_payment_refunds.status
        WHEN stripe_payment_refunds.status = 'succeeded' AND excluded.status IN ('pending', 'requires_action') THEN 'succeeded'
        ELSE excluded.status END,
      last_event_id = excluded.last_event_id, refreshed_at = datetime('now')`)
    .bind(objectId(refund.id, 're'), charge.id, refund.currency, refund.amount, refund.status, refund.created, event.id);
}

async function allRefunds(env, chargeId) {
  const refunds = [];
  let after = '';
  // Bounded pagination: an exceptional charge with >500 refunds is flagged
  // for reconciliation, never silently truncated or acknowledged complete.
  for (let page = 0; page < 5; page++) {
    const result = await readStripe(env, `/refunds?charge=${chargeId}&limit=100${after ? `&starting_after=${after}` : ''}`);
    if (!Array.isArray(result.data)) fail('invalid_refund_list');
    refunds.push(...result.data);
    if (!result.has_more) return refunds;
    if (!result.data.length) fail('invalid_refund_cursor');
    after = objectId(result.data.at(-1), 're');
  }
  fail('refund_page_limit');
}

export async function stageCollectedRevenue(env, event, ctx) {
  if (!REVENUE_EVENTS.has(event.type)) return { kind: 'noop', note: 'not_revenue_event' };
  try {
    const object = event.data?.object;
    const refund = event.type.startsWith('refund.')
      ? await readStripe(env, `/refunds/${objectId(object?.id, 're')}`) : null;
    const chargeId = objectId(refund ? refund.charge : object?.id, 'ch');
    const charge = await readStripe(env, `/charges/${chargeId}`);
    if (charge.id !== chargeId || charge.livemode !== resolveExpectedLivemode(env).expected) fail('charge_mode_mismatch');
    // A card authorization is not collected money. Zero-dollar/trial invoices
    // have no charge and subscription-state events never reach this path.
    if (charge.paid !== true || charge.status !== 'succeeded' || charge.amount_captured === 0) {
      return { kind: 'noop', note: 'charge_not_captured' };
    }
    const context = await chargeContext(env, charge);
    const environment = canonicalEnvironmentName(env);
    const stamp = canonicalizeEnvironmentStamp(context.stamp);
    if (!environment || !stamp) fail('environment_unresolved');
    if (stamp !== environment) return { kind: 'noop', note: 'revenue_other_environment' };
    const db = getDb(env);
    const statements = [paymentStatement(db, charge, context, event, environment)];
    // Fetch existing refunds even on a delayed purchase event. This also
    // handles a refund arriving before its charge webhook without losing it.
    const refunds = await allRefunds(env, chargeId);
    if (refund && !refunds.some((r) => r.id === refund.id)) refunds.push(refund);
    const unique = new Map(refunds.map((r) => [r.id, r]));
    for (const current of unique.values()) statements.push(refundStatement(db, current, charge, event));
    statements.push(paymentAttributionStatement(db, { chargeId, environment }));
    ctx.statements.push(...statements); // same D1 batch as the event processed mark
    return { kind: 'ok' };
  } catch (error) {
    // No payloads, tokens, email addresses, or untrusted Stripe errors in logs.
    const reason = /^revenue_[a-z_0-9]+$/.test(error?.message || '') ? error.message : 'revenue_read_or_stage_failed';
    return { kind: 'transient', reason };
  }
}
