// Trial→paid conversion: exactly-once semantics anchored by the durable
// ledger, with the usage resets riding the SAME atomic batch as the plan
// write and the processed-mark (owner-mandated matrix).
//
//  (a) conversion applies once: plan updated, both usage resets executed,
//      exactly one GA4 purchase
//  (b) immediate replay → 200 before any handler runs; zero extra effects
//  (c) replay with KV wiped entirely → durable ledger still short-circuits
//  (d) stale out-of-order event → all side effects skipped, still processed
//  (e) non-trial upgrade (essential→pro) → no conversion side effects
//  (f) crash gap: mid-batch failure rolls EVERYTHING back (plan + resets),
//      event stays retryable, and the retry applies everything exactly once
import assert from 'node:assert';
import { onRequest } from '../../api/stripe-webhook.js';
import {
  createFakeD1, createFakeKV, makeEnv, makeEvent, makeSubscription,
  postWebhook, stubStripeFetch
} from './billing-test-helper.mjs';

const START = 1755000000, END = 1757678400;

const trialUser = (over = {}) => ({
  id: 1, auth_id: 'uid_T', email: 't@example.com', plan: 'trial',
  stripe_customer_id: 'cus_T', stripe_subscription_id: 'sub_T', subscription_status: 'trialing',
  trial_ends_at: '2026-08-14T00:00:00.000Z', current_period_start: null, current_period_end: null,
  cancel_at: null, scheduled_plan: null, scheduled_at: null,
  has_ever_paid: 0, plan_updated_at: '2026-08-10T00:00:00.000Z', ...over
});

const usageSeed = () => ({
  feature_daily_usage: [
    { user_id: 1, feature: 'interview_questions', used: 3 },
    { user_id: 1, feature: 'other_feature', used: 9 }
  ],
  usage_events: [
    { user_id: 1, feature: 'resume_feedback', at: 'x' },
    { user_id: 1, feature: 'resume_feedback', at: 'y' }
  ]
});

const cusStub = { match: '/v1/customers/cus_T', reply: { json: { id: 'cus_T', email: 't@example.com', metadata: { firebaseUid: 'uid_T' } } } };
const conversionSub = () => makeSubscription({
  id: 'sub_T', customer: 'cus_T', status: 'active',
  priceId: 'price_essential_test', metadata: { firebaseUid: 'uid_T', original_plan: 'trial' },
  itemPeriodStart: START, itemPeriodEnd: END
});
const ga4Purchases = (stub) => stub.calls.filter((c) => c.url.includes('google-analytics') && String(c.init?.body || '').includes('trial_converted'));

// ── (a) conversion applies exactly once ──
{
  const db = createFakeD1({ users: [trialUser()], ...usageSeed() });
  const kv = createFakeKV();
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv, GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 's' });
  const stub = stubStripeFetch([cusStub]);
  const event = makeEvent('customer.subscription.updated', conversionSub());

  const res = await postWebhook(onRequest, env, event);
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_T');
  assert.strictEqual(row.plan, 'essential', 'trial converted to paid plan');
  assert.strictEqual(row.subscription_status, 'active');
  assert.strictEqual(row.has_ever_paid, 1);
  assert.strictEqual(db.__state.tables.feature_daily_usage.filter((r) => r.feature === 'interview_questions').length, 0, 'interview usage reset once');
  assert.strictEqual(db.__state.tables.feature_daily_usage.filter((r) => r.feature === 'other_feature').length, 1, 'unrelated usage untouched');
  assert.strictEqual(db.__state.tables.usage_events.length, 0, 'resume feedback usage reset once');
  assert.strictEqual(ga4Purchases(stub).length, 1, 'exactly one GA4 purchase (post-commit)');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');

  // The resets and plan write commit in ONE batch together with the
  // processed-mark (atomic completion — no crash gap).
  const commitBatch = db.__state.batches.find((b) => Array.isArray(b) && b.some((sql) => sql.includes('UPDATE users SET')));
  assert.ok(commitBatch.some((sql) => sql.includes('feature_daily_usage')), 'interview reset rides the batch');
  assert.ok(commitBatch.some((sql) => sql.includes('usage_events')), 'feedback reset rides the batch');
  // (dev0 integration) the mark may be the recipient-guarded form
  // (status = CASE WHEN … THEN 'processed' ELSE NULL END); either way it is
  // the ledger UPDATE and it is the FINAL statement of the batch.
  assert.ok(/^UPDATE stripe_event_ledger\s+SET status = (CASE WHEN .* THEN )?'processed'/s.test(commitBatch[commitBatch.length - 1].replace(/\s+/g, ' ')), 'processed-mark is the final batch statement');

  // ── (b) immediate replay: zero additional effects ──
  const writesBefore = db.__state.writes;
  const res2 = await postWebhook(onRequest, env, event);
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(db.__state.writes, writesBefore, 'replay performs zero writes');
  assert.strictEqual(ga4Purchases(stub).length, 1, 'no second GA4 purchase');
  assert.strictEqual(db.ledgerRow(event.id)?.attempt_count, 1);

  // ── (c) replay with KV wiped: the durable ledger still blocks ──
  kv.__map.clear();
  const res3 = await postWebhook(onRequest, env, event);
  assert.strictEqual(res3.status, 200);
  assert.strictEqual(db.__state.writes, writesBefore, 'KV loss cannot enable reprocessing');
  assert.strictEqual(ga4Purchases(stub).length, 1);
  stub.restore();
}

// ── (c2) defense-in-depth: even if BOTH ledger row and KV were lost, the
// re-read previousPlan (now paid) makes isTrialConversion false — no second
// reset/GA4, D1 write idempotent ──
{
  const db = createFakeD1({ users: [trialUser({ plan: 'essential', subscription_status: 'active', plan_updated_at: '2026-08-15T00:00:00.000Z', has_ever_paid: 1 })], ...usageSeed() });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV(), GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 's' });
  const stub = stubStripeFetch([cusStub]);
  const event = makeEvent('customer.subscription.updated', conversionSub(), { created: Math.floor(Date.parse('2026-08-16T00:00:00Z') / 1000) });
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_T').plan, 'essential', 'idempotent write');
  assert.strictEqual(db.__state.tables.usage_events.length, 2, 'no usage reset when previousPlan is already paid');
  assert.strictEqual(ga4Purchases(stub).length, 0, 'no conversion GA4 when previousPlan is already paid');
}

// ── (d) stale out-of-order event: side effects gated on planApplied ──
{
  const db = createFakeD1({ users: [trialUser({ plan: 'pro', plan_updated_at: '2026-08-15T00:00:00.000Z' })], ...usageSeed() });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV(), GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 's' });
  const stub = stubStripeFetch([cusStub]);
  const event = makeEvent('customer.subscription.updated', conversionSub(), { created: Math.floor(Date.parse('2026-08-01T00:00:00Z') / 1000) });
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_T').plan, 'pro', 'stale event does not downgrade');
  assert.strictEqual(db.__state.tables.usage_events.length, 2, 'stale event never wipes accumulated usage');
  assert.strictEqual(ga4Purchases(stub).length, 0);
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
}

// ── (e) non-trial upgrade (essential→pro): no conversion side effects ──
{
  const db = createFakeD1({ users: [trialUser({ plan: 'essential', subscription_status: 'active' })], ...usageSeed() });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV(), GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 's' });
  const stub = stubStripeFetch([cusStub]);
  const sub = makeSubscription({ id: 'sub_T', customer: 'cus_T', status: 'active', priceId: 'price_pro_test', metadata: { firebaseUid: 'uid_T' }, itemPeriodStart: START, itemPeriodEnd: END });
  const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.updated', sub));
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_T').plan, 'pro');
  assert.strictEqual(db.__state.tables.usage_events.length, 2, 'ordinary upgrades never reset usage');
  assert.strictEqual(db.__state.tables.feature_daily_usage.length, 2);
  assert.strictEqual(ga4Purchases(stub).length, 0);
}

// ── (f) crash gap closed: mid-batch failure rolls back plan AND resets
// together; the retry applies everything exactly once ──
{
  const db = createFakeD1({ users: [trialUser()], ...usageSeed() });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV(), GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 's' });
  const stub = stubStripeFetch([cusStub]);
  const event = makeEvent('customer.subscription.updated', conversionSub());

  // The LAST reset in the batch fails → the whole batch (plan write, first
  // reset, processed-mark) must roll back.
  db.failNext('DELETE FROM usage_events');
  const res1 = await postWebhook(onRequest, env, event);
  assert.strictEqual(res1.status, 503, 'retryable');
  assert.strictEqual(db.usersByAuthId('uid_T').plan, 'trial', 'plan write rolled back with the failed reset');
  assert.strictEqual(db.__state.tables.feature_daily_usage.filter((r) => r.feature === 'interview_questions').length, 1, 'first reset rolled back too');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
  assert.strictEqual(ga4Purchases(stub).length, 0, 'no GA4 before commit');

  const res2 = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res2.status, 200, 'Stripe retry re-claims and completes');
  assert.strictEqual(db.usersByAuthId('uid_T').plan, 'essential');
  assert.strictEqual(db.__state.tables.usage_events.length, 0, 'resets applied exactly once');
  assert.strictEqual(ga4Purchases(stub).length, 1, 'GA4 fired exactly once, after the successful commit');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
  assert.strictEqual(db.ledgerRow(event.id)?.attempt_count, 2);
}

console.log('trial-conversion.test.mjs: all assertions passed');
