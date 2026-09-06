// Fulfilment eligibility through the hardened webhook, with realistic Checkout
// Session fields (status, payment_status, mode, subscription, line_items):
//   - only a COMPLETE session with payment_status paid/no_payment_required
//     grants a pack; 'unpaid' (delayed payment methods) is a recorded no-op
//     and checkout.session.async_payment_succeeded fulfils it exactly once
//   - a "completed" event for a session Stripe still shows open/expired is a
//     critical failure: no credits, no plan, ledger failed (a fabricated or
//     replayed completion can never establish entitlement)
//   - a subscription-mode session fulfils only through an ENTITLED
//     subscription; incomplete/incomplete_expired/canceled write no plan
//   - invoice.payment_failed reads the basil invoice shape
//     (invoice.parent.subscription_details) as well as the legacy shape
// Run: node app/functions/_lib/__tests__/stripe-webhook-fulfilment.test.mjs
import assert from 'node:assert';
import { onRequest } from '../../api/stripe-webhook.js';
import { PACK_SESSION_COUNT, buildPackGrantStatements } from '../voice-entitlements.js';
import {
  createFakeD1, createFakeKV, makeEnv, makeEvent, makeSubscription, makeCheckoutSession, makeBasilInvoice,
  postWebhook, stubStripeFetch
} from './billing-test-helper.mjs';

const START = 1755000000, END = 1757678400;
const devEnv = (over = {}) => makeEnv({ ENVIRONMENT: 'dev', STRIPE_SECRET_KEY: 'sk_test_fake', FRONTEND_URL: 'https://dev.jobhackai.io', GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 's', ...over });
const user = (over = {}) => ({
  id: 1, auth_id: 'uid_F', email: 'f@example.com', plan: 'free',
  stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null,
  trial_ends_at: null, current_period_start: null, current_period_end: null,
  cancel_at: null, scheduled_plan: null, scheduled_at: null,
  has_ever_paid: 0, plan_updated_at: '2020-01-01T00:00:00.000Z',
  voice_sessions_remaining: 0, free_session_used: 0, pack_expires_at: null, ...over
});
const cusStub = { match: '/v1/customers/cus_F', reply: { json: { id: 'cus_F', email: 'f@example.com', metadata: { firebaseUid: 'uid_F' } } } };
const sessionStub = (sess) => ({ match: `/v1/checkout/sessions/${sess.id}`, reply: { json: sess } });
const pack = (over = {}) => makeCheckoutSession({ id: 'cs_pack_f', mode: 'payment', customer: 'cus_F', metadata: { plan: 'pack', firebaseUid: 'uid_F' }, ...over });
const completedEvent = (sess, type = 'checkout.session.completed') => makeEvent(type, sess, { livemode: false });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); process.exitCode = 1; }
}

console.log('stripe-webhook fulfilment suite\n');

await test('paid + complete pack session grants; no_payment_required (100% promotion code) grants too', async () => {
  for (const paymentStatus of ['paid', 'no_payment_required']) {
    const db = createFakeD1({ users: [user()] });
    const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
    const sess = pack({ paymentStatus, amountTotal: paymentStatus === 'paid' ? 3900 : 0 });
    const stub = stubStripeFetch([sessionStub(sess), cusStub]);
    const res = await postWebhook(onRequest, env, completedEvent(sess));
    stub.restore();
    assert.strictEqual(res.status, 200, paymentStatus);
    assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, PACK_SESSION_COUNT, `${paymentStatus} fulfils`);
  }
});

await test('completed but payment_status=unpaid (delayed payment method): recorded no-op, nothing granted', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const sess = pack({ paymentStatus: 'unpaid' });
  const stub = stubStripeFetch([sessionStub(sess), cusStub]);
  const event = completedEvent(sess);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_F');
  assert.strictEqual(row.voice_sessions_remaining, 0, 'no credits before the payment settles');
  assert.strictEqual(row.plan, 'free');
  assert.strictEqual(db.eventLogRow(event.id), null, 'no grant record');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed', 'the completion event itself is done');
  assert.deepStrictEqual(db.__state.batches[0].filter((sql) => sql.startsWith('UPDATE users') || sql.startsWith('INSERT INTO stripe_event_log')), [], 'no billing writes');
});

await test('async_payment_succeeded fulfils the delayed pack exactly once; a replay grants nothing more; async_payment_failed grants nothing', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const pending = pack({ paymentStatus: 'unpaid' });
  let stub = stubStripeFetch([sessionStub(pending), cusStub]);
  assert.strictEqual((await postWebhook(onRequest, env, completedEvent(pending))).status, 200);
  stub.restore();
  assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, 0);

  const settled = pack({ paymentStatus: 'paid' });
  stub = stubStripeFetch([sessionStub(settled), cusStub]);
  const succeeded = completedEvent(settled, 'checkout.session.async_payment_succeeded');
  const res = await postWebhook(onRequest, env, succeeded);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, PACK_SESSION_COUNT, 'fulfilled on the settled event');
  assert.ok(db.eventLogRow(succeeded.id), 'grant recorded under the fulfilment event id');
  const writes = db.__state.writes;
  assert.strictEqual((await postWebhook(onRequest, env, succeeded)).status, 200, 'replay');
  assert.strictEqual(db.__state.writes, writes, 'replay writes nothing');
  assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, PACK_SESSION_COUNT);
  stub.restore();

  const db2 = createFakeD1({ users: [user()] });
  const env2 = devEnv({ DB: db2, JOBHACKAI_KV: createFakeKV() });
  const failedEvent = completedEvent(pack({ paymentStatus: 'unpaid' }), 'checkout.session.async_payment_failed');
  const res2 = await postWebhook(onRequest, env2, failedEvent);
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(db2.usersByAuthId('uid_F').voice_sessions_remaining, 0);
  assert.strictEqual(db2.ledgerRow(failedEvent.id)?.status, 'processed');
});

await test('a "completed" event for a session Stripe shows as open or expired is critical: no grant, no plan, ledger failed', async () => {
  for (const status of ['open', 'expired']) {
    const db = createFakeD1({ users: [user()] });
    const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
    // The (forged/synthetic) event payload claims complete+paid; the fetched session says otherwise.
    const payload = pack();
    const fetched = pack({ status, paymentStatus: 'unpaid' });
    const stub = stubStripeFetch([sessionStub(fetched), cusStub]);
    const event = completedEvent(payload);
    const res = await postWebhook(onRequest, env, event);
    stub.restore();
    assert.strictEqual(res.status, 500, status);
    assert.strictEqual(await res.text(), 'event failed: session_not_complete');
    assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, 0);
    assert.strictEqual(db.usersByAuthId('uid_F').plan, 'free');
    assert.strictEqual(db.__state.batches.length, 0);
    assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
  }
});

await test('a subscription-mode session cannot establish a paid plan while its subscription is incomplete; the later active update can', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const sess = makeCheckoutSession({ id: 'cs_m_inc', mode: 'subscription', paymentStatus: 'unpaid', customer: 'cus_F', subscription: 'sub_inc', priceId: 'price_monthly_test', unitAmount: 3400, metadata: { plan: 'monthly', firebaseUid: 'uid_F' } });
  let stub = stubStripeFetch([
    sessionStub(sess),
    { match: '/v1/subscriptions/sub_inc', reply: { json: makeSubscription({ id: 'sub_inc', customer: 'cus_F', status: 'incomplete', priceId: 'price_monthly_test', metadata: { firebaseUid: 'uid_F' }, itemPeriodStart: START, itemPeriodEnd: END }) } },
    cusStub
  ]);
  const event = completedEvent(sess);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_F');
  assert.strictEqual(row.plan, 'free', 'no paid plan from an incomplete subscription');
  assert.strictEqual(row.stripe_subscription_id, null);
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');

  stub = stubStripeFetch([cusStub]);
  const active = makeSubscription({ id: 'sub_inc', customer: 'cus_F', status: 'active', priceId: 'price_monthly_test', metadata: { firebaseUid: 'uid_F' }, itemPeriodStart: START, itemPeriodEnd: END });
  const res2 = await postWebhook(onRequest, env, makeEvent('customer.subscription.updated', active, { livemode: false }));
  stub.restore();
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_F').plan, 'monthly', 'the entitled update establishes the plan');
});

await test('a subscription-mode session without a subscription is critical (nothing to verify): no plan write', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const sess = makeCheckoutSession({ id: 'cs_m_nosub', mode: 'subscription', customer: 'cus_F', subscription: null, priceId: 'price_monthly_test', metadata: { plan: 'monthly', firebaseUid: 'uid_F' } });
  const stub = stubStripeFetch([sessionStub(sess), cusStub]);
  const event = completedEvent(sess);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 500);
  assert.strictEqual(await res.text(), 'event failed: subscription_missing_on_session');
  assert.strictEqual(db.usersByAuthId('uid_F').plan, 'free');
  assert.strictEqual(db.__state.batches.length, 0);
});

await test('trialing subscription from a checkout with no_payment_required still fulfils (trial flow unchanged)', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const sess = makeCheckoutSession({ id: 'cs_trial', mode: 'subscription', paymentStatus: 'no_payment_required', customer: 'cus_F', subscription: 'sub_tr', priceId: 'price_essential_test', amountTotal: 0, metadata: { plan: 'trial', firebaseUid: 'uid_F' } });
  const stub = stubStripeFetch([
    sessionStub(sess),
    { match: '/v1/subscriptions/sub_tr', reply: { json: makeSubscription({ id: 'sub_tr', customer: 'cus_F', status: 'trialing', priceId: 'price_essential_test', metadata: { firebaseUid: 'uid_F', original_plan: 'trial' }, trialEnd: END, itemPeriodStart: START, itemPeriodEnd: END }) } },
    cusStub
  ]);
  const res = await postWebhook(onRequest, env, completedEvent(sess));
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_F').plan, 'trial');
  assert.strictEqual(db.usersByAuthId('uid_F').stripe_subscription_id, 'sub_tr');
});

await test('invoice.payment_failed reads the basil shape (invoice.parent.subscription_details) and records dunning; legacy shape still works', async () => {
  for (const shape of ['basil', 'legacy']) {
    const db = createFakeD1({ users: [user({ plan: 'monthly', subscription_status: 'active', stripe_customer_id: 'cus_F', stripe_subscription_id: 'sub_dun', has_ever_paid: 1 })] });
    const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
    const invoice = shape === 'basil'
      ? makeBasilInvoice({ id: 'in_dun', customer: 'cus_F', subscriptionId: 'sub_dun', subscriptionMetadata: { firebaseUid: 'uid_F', environment: 'dev' } })
      : { id: 'in_dun', object: 'invoice', customer: 'cus_F', subscription: 'sub_dun', subscription_details: { metadata: { firebaseUid: 'uid_F', environment: 'dev' } } };
    const stub = stubStripeFetch([cusStub, { match: '/v1/subscriptions/sub_dun', reply: { json: makeSubscription({ id: 'sub_dun', customer: 'cus_F', status: 'past_due', priceId: 'price_monthly_test', metadata: { firebaseUid: 'uid_F', environment: 'dev' } }) } }]);
    const event = makeEvent('invoice.payment_failed', invoice, { livemode: false });
    const res = await postWebhook(onRequest, env, event);
    stub.restore();
    assert.strictEqual(res.status, 200, shape);
    assert.strictEqual(db.usersByAuthId('uid_F').subscription_status, 'past_due', `${shape}: dunning recorded`);
    assert.strictEqual(db.usersByAuthId('uid_F').plan, 'monthly', 'plan kept through dunning');
    assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
  }
});

await test('basil invoice stamped for another environment is ignored pre-claim (zero writes)', async () => {
  const db = createFakeD1({ users: [user({ plan: 'monthly', subscription_status: 'active', stripe_subscription_id: 'sub_qa' })] });
  const kv = createFakeKV();
  const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
  const invoice = makeBasilInvoice({ id: 'in_qa', customer: 'cus_F', subscriptionId: 'sub_qa', subscriptionMetadata: { firebaseUid: 'uid_F', environment: 'qa' } });
  const event = makeEvent('invoice.payment_failed', invoice, { livemode: false });
  const res = await postWebhook(onRequest, env, event);
  assert.strictEqual(await res.text(), '[ignored-other-environment]');
  assert.strictEqual(db.__state.writes, 0);
  assert.strictEqual(kv.writeCount, 0);
  assert.strictEqual(db.ledgerRow(event.id), null);
});

// ── One purchase, several events: fulfilment is idempotent per Checkout Session ──
// Stripe may create checkout.session.completed while the payment is pending
// (payment_status unpaid) and deliver/retry it AFTER the payment settled, so
// the re-fetched session is already paid — and it ALSO sends a distinct
// checkout.session.async_payment_succeeded for the same cs_ id. Both are
// genuine, both carry paid state at fetch time, and only ONE may grant.
const paidPack = () => pack({ paymentStatus: 'paid' });
const lateCompleted = () => makeEvent('checkout.session.completed', pack({ paymentStatus: 'unpaid' }), { livemode: false }); // payload snapshot: still unpaid
const asyncSucceeded = () => makeEvent('checkout.session.async_payment_succeeded', paidPack(), { livemode: false });

await test('order A: late-delivered completed (fetched paid) grants; the distinct async_payment_succeeded for the same session is a no-op — 5 credits, not 10', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([sessionStub(paidPack()), cusStub]);
  const e1 = lateCompleted();
  const e2 = asyncSucceeded();
  assert.notStrictEqual(e1.id, e2.id);
  assert.strictEqual((await postWebhook(onRequest, env, e1)).status, 200);
  assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, PACK_SESSION_COUNT);
  assert.strictEqual((await postWebhook(onRequest, env, e2)).status, 200);
  stub.restore();
  assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, PACK_SESSION_COUNT, 'second distinct event for the same session grants nothing');
  assert.strictEqual(db.ledgerRow(e1.id)?.status, 'processed');
  assert.strictEqual(db.ledgerRow(e2.id)?.status, 'processed', 'the no-op is recorded, not retried');
  assert.ok(db.eventLogRow(e1.id), 'granting event recorded');
  assert.strictEqual(db.eventLogRow(e2.id), null, 'no grant record for the no-op event');
  assert.strictEqual(db.eventLogRow('cs_pack_f')?.type, 'pack_fulfilment', 'session marker present');
});

await test('order B: async_payment_succeeded first grants; the late completed for the same session is a no-op', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([sessionStub(paidPack()), cusStub]);
  const e1 = asyncSucceeded();
  const e2 = lateCompleted();
  assert.strictEqual((await postWebhook(onRequest, env, e1)).status, 200);
  assert.strictEqual((await postWebhook(onRequest, env, e2)).status, 200);
  stub.restore();
  assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, PACK_SESSION_COUNT);
  assert.ok(db.eventLogRow(e1.id));
  assert.strictEqual(db.eventLogRow(e2.id), null);
  assert.strictEqual(db.ledgerRow(e2.id)?.status, 'processed');
});

await test('same-event replay after the session is fulfilled: zero writes (ledger), credits unchanged', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([sessionStub(paidPack()), cusStub]);
  const e1 = asyncSucceeded();
  assert.strictEqual((await postWebhook(onRequest, env, e1)).status, 200);
  const writes = db.__state.writes;
  assert.strictEqual((await postWebhook(onRequest, env, e1)).status, 200);
  stub.restore();
  assert.strictEqual(db.__state.writes, writes);
  assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, PACK_SESSION_COUNT);
});

await test('concurrent delivery of two distinct events for one session: the loser\'s batch is refused atomically (503), its retry is a recorded no-op — 5 credits', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([sessionStub(paidPack()), cusStub]);
  const e1 = lateCompleted();
  const e2 = asyncSucceeded();
  // Race: e2's pre-check ran before e1 committed, so it sees no marker. Simulate
  // by making the pre-check for e2 return nothing while the table already has
  // e1's rows — the atomic INSERT of the session marker is what must stop it.
  assert.strictEqual((await postWebhook(onRequest, env, e1)).status, 200);
  const realPrepare = db.prepare.bind(db);
  let blind = true;
  db.prepare = (sql) => {
    if (blind && sql === 'SELECT event_id, type FROM stripe_event_log WHERE event_id IN (?1, ?2)') {
      const stmt = realPrepare(sql);
      return { ...stmt, bind: () => ({ all: async () => ({ results: [] }), first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) };
    }
    return realPrepare(sql);
  };
  const res = await postWebhook(onRequest, env, e2);
  assert.strictEqual(res.status, 503, 'the race loser is refused by the marker, not by the read');
  assert.strictEqual(await res.text(), 'event failed: event_log_conflict');
  assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, PACK_SESSION_COUNT, 'no double credit');
  assert.strictEqual(db.eventLogRow(e2.id), null, 'loser wrote nothing (batch rolled back)');
  assert.strictEqual(db.ledgerRow(e2.id)?.status, 'failed');
  blind = false;
  db.prepare = realPrepare;
  const retry = await postWebhook(onRequest, env, e2);
  stub.restore();
  assert.strictEqual(retry.status, 200);
  assert.strictEqual(db.ledgerRow(e2.id)?.status, 'processed');
  assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, PACK_SESSION_COUNT);
});

await test('statement-level guard: two grant batches for one session cannot both commit (marker PK), independent of any read', async () => {
  const db = createFakeD1({ users: [user()] });
  await db.batch(buildPackGrantStatements(db, { uid: 'uid_F', eventId: 'evt_a', sessionId: 'cs_same' }));
  await assert.rejects(() => db.batch(buildPackGrantStatements(db, { uid: 'uid_F', eventId: 'evt_b', sessionId: 'cs_same' })), /UNIQUE constraint failed: stripe_event_log\.event_id/);
  assert.strictEqual(db.usersByAuthId('uid_F').voice_sessions_remaining, PACK_SESSION_COUNT, 'exactly one grant landed');
  assert.strictEqual(db.eventLogRow('evt_b'), null, 'the refused batch left no partial rows');
  assert.strictEqual(db.eventLogRow('cs_same')?.type, 'pack_fulfilment');
});

await test('recipient guard still holds with the session marker: missing recipient rolls back event record, session marker and credits', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([sessionStub(paidPack()), cusStub]);
  const realBatch = db.batch.bind(db);
  db.batch = async (stmts) => { db.__state.tables.users = db.__state.tables.users.filter((u) => u.auth_id !== 'uid_F'); return realBatch(stmts); };
  const e1 = asyncSucceeded();
  const res = await postWebhook(onRequest, env, e1);
  db.batch = realBatch;
  stub.restore();
  assert.strictEqual(res.status, 503);
  assert.strictEqual(await res.text(), 'event failed: recipient_row_missing');
  assert.strictEqual(db.eventLogRow(e1.id), null);
  assert.strictEqual(db.eventLogRow('cs_pack_f'), null, 'session marker rolled back too — the session is still fulfillable on retry');
});

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
