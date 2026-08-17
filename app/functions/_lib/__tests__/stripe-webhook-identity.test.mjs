// End-to-end webhook identity, idempotency, ownership-guard, period-write,
// atomic-commit, and failure-policy scenarios (R2-1/R2-5/R2-6/R2-9).
import assert from 'node:assert';
import { onRequest } from '../../api/stripe-webhook.js';
import {
  createFakeD1, createFakeKV, makeEnv, makeEvent, makeSubscription,
  postWebhook, stubStripeFetch
} from './billing-test-helper.mjs';

const START = 1755000000, END = 1757678400;
const startIso = new Date(START * 1000).toISOString();
const endIso = new Date(END * 1000).toISOString();

const user = (over = {}) => ({
  id: 1, auth_id: 'uid_A', email: 'a@example.com', plan: 'free',
  stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null,
  trial_ends_at: null, current_period_start: null, current_period_end: null,
  cancel_at: null, scheduled_plan: null, scheduled_at: null,
  has_ever_paid: 0, plan_updated_at: '2020-01-01T00:00:00.000Z', ...over
});

const cusStub = (uid, id = 'cus_A') =>
  ({ match: `/v1/customers/${id}`, reply: { json: { id, email: 'a@example.com', metadata: uid ? { firebaseUid: uid } : {} } } });

// 1. Customer metadata resolves the owner when subscription metadata is absent.
{
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_A')]);
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', metadata: {}, itemPeriodStart: START, itemPeriodEnd: END });
  const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.created', sub));
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'essential');
}

// 2. Conflicting sources → 500, ledger 'failed' with owner_conflict, no mutation.
{
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_OTHER')]);
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START, itemPeriodEnd: END });
  const event = makeEvent('customer.subscription.created', sub);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 500);
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'owner_conflict');
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'free', 'no mutation on conflict');
}

// 3. Duplicate Stripe ids in D1 → cross-user guard blocks; the OTHER user's
//    row is never updated; ledger failed + 500.
{
  const db = createFakeD1({ users: [
    user(),
    user({ id: 2, auth_id: 'uid_B', plan: 'pro', stripe_customer_id: 'cus_A', stripe_subscription_id: 'sub_dup' })
  ] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_A')]);
  const sub = makeSubscription({ id: 'sub_dup', customer: 'cus_A', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START, itemPeriodEnd: END });
  const event = makeEvent('customer.subscription.created', sub);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 500);
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'cross_user_id_conflict');
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'free');
  assert.strictEqual(db.usersByAuthId('uid_B').plan, 'pro', 'wrong user never updated');
}

// 4. Replay of the same event id → exactly one write; the ledger short-circuits.
{
  const db = createFakeD1({ users: [user()] });
  const kv = createFakeKV();
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv });
  const stub = stubStripeFetch([cusStub('uid_A')]);
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START, itemPeriodEnd: END });
  const event = makeEvent('customer.subscription.created', sub);
  const res1 = await postWebhook(onRequest, env, event);
  assert.strictEqual(res1.status, 200);
  const batchesAfterFirst = db.__state.batches.length;
  const writesAfterFirst = db.__state.writes;

  const res2 = await postWebhook(onRequest, env, event);
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(db.__state.batches.length, batchesAfterFirst, 'replay commits no batch');
  assert.strictEqual(db.__state.writes, writesAfterFirst, 'replay performs zero writes');
  assert.strictEqual(db.ledgerRow(event.id)?.attempt_count, 1, 'replay does not re-claim a processed event');

  // 4b. Same replay with KV wiped entirely — the DURABLE ledger still blocks.
  kv.__map.clear();
  const res3 = await postWebhook(onRequest, env, event);
  assert.strictEqual(res3.status, 200);
  assert.strictEqual(db.__state.writes, writesAfterFirst, 'ledger alone prevents reprocessing after KV loss');
  stub.restore();
}

// 5. checkout.session.completed stores the correct owner + periods + GA4 purchase.
{
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV(), GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 's' });
  const session = { id: 'cs_test_1', customer: 'cus_A', metadata: { plan: 'essential', firebaseUid: 'uid_A' }, customer_details: { email: 'a@example.com' } };
  const stub = stubStripeFetch([
    { match: '/v1/checkout/sessions/cs_test_1', reply: { json: { ...session, line_items: { data: [{ price: { id: 'price_essential_test', unit_amount: 2900 } }] }, subscription: 'sub_co1', amount_total: 2900, currency: 'usd' } } },
    { match: '/v1/subscriptions/sub_co1', reply: { json: makeSubscription({ id: 'sub_co1', customer: 'cus_A', itemPeriodStart: START, itemPeriodEnd: END }) } },
    cusStub('uid_A')
  ]);
  const event = makeEvent('checkout.session.completed', session);
  const res = await postWebhook(onRequest, env, event);
  const ga4Purchases = stub.calls.filter((c) => c.url.includes('google-analytics') && String(c.init?.body || '').includes('"purchase"'));
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_A');
  assert.strictEqual(row.plan, 'essential');
  assert.strictEqual(row.stripe_customer_id, 'cus_A');
  assert.strictEqual(row.stripe_subscription_id, 'sub_co1');
  assert.strictEqual(row.current_period_start, startIso);
  assert.strictEqual(row.current_period_end, endIso);
  assert.strictEqual(row.has_ever_paid, 1);
  assert.strictEqual(ga4Purchases.length, 1, 'exactly one GA4 purchase, sent post-commit');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
}

// 6. Root-shape (pre-Basil) periods are stored identically.
{
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_A')]);
  const sub = makeSubscription({ id: 'sub_root', customer: 'cus_A', metadata: { firebaseUid: 'uid_A' }, rootPeriodStart: START, rootPeriodEnd: END });
  const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.created', sub));
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_A').current_period_start, startIso);
  assert.strictEqual(db.usersByAuthId('uid_A').current_period_end, endIso);
}

// 7. Ambiguous period (two plan-mapped items) → critical failure: 500,
//    ledger failed, NO write — never the earliest date.
{
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_A')]);
  const sub = makeSubscription({
    id: 'sub_multi', customer: 'cus_A', metadata: { firebaseUid: 'uid_A' },
    items: [
      { price: { id: 'price_essential_test', unit_amount: 2900 }, current_period_start: START - 5000, current_period_end: END - 5000 },
      { price: { id: 'price_pro_test', unit_amount: 5900 }, current_period_start: START, current_period_end: END }
    ]
  });
  const event = makeEvent('customer.subscription.created', sub);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 500);
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'period_ambiguous_subscription_items');
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'free', 'no write on ambiguous period');
}

// 8. subscription.updated refreshes status/dates on the correct row.
{
  const db = createFakeD1({ users: [
    user({ plan: 'essential', stripe_customer_id: 'cus_A', stripe_subscription_id: 'sub_1', subscription_status: 'active' }),
    user({ id: 2, auth_id: 'uid_B', plan: 'pro', stripe_customer_id: 'cus_B', stripe_subscription_id: 'sub_B' })
  ] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_A')]);
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', status: 'active', priceId: 'price_pro_test', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START + 100, itemPeriodEnd: END + 100 });
  const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.updated', sub));
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'pro');
  assert.strictEqual(db.usersByAuthId('uid_A').current_period_end, new Date((END + 100) * 1000).toISOString());
  assert.strictEqual(db.usersByAuthId('uid_B').plan, 'pro', 'other user untouched');
  assert.strictEqual(db.usersByAuthId('uid_B').current_period_end, null);
}

// 9. subscription.deleted → free, ids/periods cleared, customer id + trial date preserved.
{
  const db = createFakeD1({ users: [user({
    plan: 'essential', stripe_customer_id: 'cus_A', stripe_subscription_id: 'sub_1',
    subscription_status: 'active', current_period_start: startIso, current_period_end: endIso,
    trial_ends_at: '2026-05-05T00:00:00.000Z'
  })] });
  const kv = createFakeKV({ 'user:uid_A:lastResume': 'x', 'usage:uid_A': 'y' });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv });
  const deletedSub = makeSubscription({ id: 'sub_1', customer: 'cus_A', status: 'canceled', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START, itemPeriodEnd: END });
  const stub = stubStripeFetch([
    cusStub('uid_A'),
    { match: '/v1/subscriptions?customer=cus_A', reply: { json: { data: [] } } }
  ]);
  const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.deleted', deletedSub));
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_A');
  assert.strictEqual(row.plan, 'free');
  assert.strictEqual(row.subscription_status, 'canceled');
  assert.strictEqual(row.stripe_subscription_id, null);
  assert.strictEqual(row.stripe_customer_id, 'cus_A', 'customer id preserved (product rule)');
  assert.strictEqual(row.current_period_start, null, 'period start cleared');
  assert.strictEqual(row.current_period_end, null, 'period end cleared');
  assert.strictEqual(row.trial_ends_at, '2026-05-05T00:00:00.000Z', 'trial date preserved (blocks trial re-use)');
  assert.ok(kv.__deletes.includes('user:uid_A:lastResume'), 'resume KV cleaned post-commit');
}

// 10. invoice.payment_failed → status-only write for the intended user.
{
  const db = createFakeD1({ users: [user({ plan: 'essential', stripe_customer_id: 'cus_A', stripe_subscription_id: 'sub_1', subscription_status: 'active' })] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([
    cusStub('uid_A'),
    { match: '/v1/subscriptions/sub_1', reply: { json: makeSubscription({ id: 'sub_1', customer: 'cus_A', status: 'past_due', itemPeriodStart: START, itemPeriodEnd: END }) } }
  ]);
  const res = await postWebhook(onRequest, env, makeEvent('invoice.payment_failed', { id: 'in_1', customer: 'cus_A', subscription: 'sub_1' }));
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_A');
  assert.strictEqual(row.subscription_status, 'past_due');
  assert.strictEqual(row.plan, 'essential', 'plan untouched by payment-failure status write');
}

// 10b. invoice.payment_failed with subscription still active → deliberate no-op.
{
  const db = createFakeD1({ users: [user({ plan: 'essential', stripe_customer_id: 'cus_A', stripe_subscription_id: 'sub_1', subscription_status: 'active' })] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([
    cusStub('uid_A'),
    { match: '/v1/subscriptions/sub_1', reply: { json: makeSubscription({ id: 'sub_1', customer: 'cus_A', status: 'active', itemPeriodStart: START, itemPeriodEnd: END }) } }
  ]);
  const event = makeEvent('invoice.payment_failed', { id: 'in_2', customer: 'cus_A', subscription: 'sub_1' });
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_A').subscription_status, 'active');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed', 'deliberate no-op counts as processed');
}

// 10c. Non-subscription invoice → no-op processed, zero user writes.
{
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const event = makeEvent('invoice.payment_failed', { id: 'in_3', customer: 'cus_A', subscription: null });
  const res = await postWebhook(onRequest, env, event);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
}

// 11. Unresolved owner (no metadata anywhere, customer 404) → 500 + failed.
{
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([{ match: '/v1/customers/cus_A', reply: { status: 404, json: { error: { message: 'No such customer' } } } }]);
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', metadata: {}, itemPeriodStart: START, itemPeriodEnd: END });
  const event = makeEvent('customer.subscription.created', sub);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 500);
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'unresolved_owner');
}

// 12. ATOMIC COMMIT: a mid-batch failure commits NOTHING (plan write rolled
//     back), the event is marked failed/retryable, and Stripe's retry then
//     succeeds by re-claiming the failed row.
{
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_A')]);
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START, itemPeriodEnd: END });
  const event = makeEvent('customer.subscription.created', sub);

  db.failNext('UPDATE users SET');
  const res1 = await postWebhook(onRequest, env, event);
  assert.strictEqual(res1.status, 503, 'batch failure is retryable');
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'free', 'rolled back — no partial commit');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'batch_write_failed');

  const res2 = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res2.status, 200, 'retry re-claims the failed event');
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'essential');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
  assert.strictEqual(db.ledgerRow(event.id)?.attempt_count, 2);
}

// 13. UNIQUE-index refusal mid-batch (migration 023) → 500 + failed marker.
{
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_A')]);
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START, itemPeriodEnd: END });
  const event = makeEvent('customer.subscription.created', sub);
  db.failNext('UPDATE users SET', new Error('UNIQUE constraint failed: users.stripe_subscription_id'));
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 500);
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'unique_index_conflict');
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'free');
}

// 14. Out-of-order event (older than plan_updated_at) → skipped write, but
//     still processed (nothing to retry).
{
  const db = createFakeD1({ users: [user({ plan: 'pro', plan_updated_at: '2026-08-10T00:00:00.000Z' })] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_A')]);
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START, itemPeriodEnd: END });
  const event = makeEvent('customer.subscription.created', sub, { created: Math.floor(Date.parse('2026-08-01T00:00:00Z') / 1000) });
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'pro', 'stale event never overwrites newer state');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
}

// 15. In-flight event (fresh 'processing' row) → 503 untouched; a stale
//     'processing' row (crashed run) is re-claimed and processed.
{
  const freshDb = createFakeD1({
    users: [user()],
    stripe_event_ledger: [{ event_id: 'evt_inflight', event_type: 'x', livemode: 1, status: 'processing', attempt_count: 1, received_at: new Date().toISOString(), claimed_at: new Date().toISOString(), processed_at: null, last_error: null }]
  });
  const env1 = makeEnv({ DB: freshDb, JOBHACKAI_KV: createFakeKV() });
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START, itemPeriodEnd: END });
  const res1 = await postWebhook(onRequest, env1, makeEvent('customer.subscription.created', sub, { id: 'evt_inflight' }));
  assert.strictEqual(res1.status, 503, 'fresh processing row → in flight');
  assert.strictEqual(freshDb.ledgerRow('evt_inflight').attempt_count, 1, 'not re-claimed');

  const staleDb = createFakeD1({
    users: [user()],
    stripe_event_ledger: [{ event_id: 'evt_stale', event_type: 'x', livemode: 1, status: 'processing', attempt_count: 1, received_at: new Date(Date.now() - 3600e3).toISOString(), claimed_at: new Date(Date.now() - 3600e3).toISOString(), processed_at: null, last_error: null }]
  });
  const env2 = makeEnv({ DB: staleDb, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_A')]);
  const res2 = await postWebhook(onRequest, env2, makeEvent('customer.subscription.created', sub, { id: 'evt_stale' }));
  stub.restore();
  assert.strictEqual(res2.status, 200, 'stale claim recovered');
  assert.strictEqual(staleDb.ledgerRow('evt_stale').status, 'processed');
  assert.strictEqual(staleDb.ledgerRow('evt_stale').attempt_count, 2);
}

// 16. Tombstoned user (no row + tombstone) → deliberate no-op, processed, no row created.
{
  const db = createFakeD1({ users: [], deleted_auth_ids: [{ auth_id: 'uid_gone', email: 'gone@example.com' }] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_gone')]);
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', metadata: { firebaseUid: 'uid_gone' }, itemPeriodStart: START, itemPeriodEnd: END });
  const event = makeEvent('customer.subscription.created', sub);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_gone'), null, 'deleted user never resurrected');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
}

// 17. Transient Stripe failure during identity → 503 + failed (retryable).
{
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([{ match: '/v1/customers/cus_A', reply: { status: 500, json: {} } }]);
  const sub = makeSubscription({ id: 'sub_1', customer: 'cus_A', metadata: {}, itemPeriodStart: START, itemPeriodEnd: END });
  const event = makeEvent('customer.subscription.created', sub);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 503);
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'transient_stripe_failure');
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'free');
}

// 18. Two legitimate-subscriber fixtures stay paid through an unrelated
//     event volley (gate + guard never touch them).
{
  const db = createFakeD1({ users: [
    user({ plan: 'essential', stripe_customer_id: 'cus_L1', stripe_subscription_id: 'sub_L1', subscription_status: 'active', has_ever_paid: 1 }),
    user({ id: 2, auth_id: 'uid_L2', plan: 'pro', stripe_customer_id: 'cus_L2', stripe_subscription_id: 'sub_L2', subscription_status: 'active', has_ever_paid: 1 }),
    user({ id: 3, auth_id: 'uid_C' })
  ] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_C', 'cus_C')]);
  // Wrong-mode volley + a valid event for a third user.
  await postWebhook(onRequest, env, makeEvent('customer.subscription.created', makeSubscription({ id: 'sub_x', customer: 'cus_C', metadata: { firebaseUid: 'uid_C' } , itemPeriodStart: START, itemPeriodEnd: END }), { livemode: false }));
  await postWebhook(onRequest, env, makeEvent('customer.subscription.created', makeSubscription({ id: 'sub_x', customer: 'cus_C', metadata: { firebaseUid: 'uid_C' }, itemPeriodStart: START, itemPeriodEnd: END })));
  stub.restore();
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'essential');
  assert.strictEqual(db.usersByAuthId('uid_A').subscription_status, 'active');
  assert.strictEqual(db.usersByAuthId('uid_L2').plan, 'pro');
  assert.strictEqual(db.usersByAuthId('uid_C').plan, 'essential', 'third user processed normally');
}

console.log('stripe-webhook-identity.test.mjs: all assertions passed');
