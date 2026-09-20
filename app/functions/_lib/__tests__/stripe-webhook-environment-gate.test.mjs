// Environment stamp + gate (dev/QA isolation, code half). Dev and QA share
// one Stripe test-mode account, so both webhooks receive every test event.
// Checkout stamps metadata.environment on the objects it creates; the
// webhook acknowledges objects stamped for ANOTHER environment with zero
// D1/KV writes and no ledger row. Un-stamped and own-stamped objects are
// processed as before. Production (live mode) is unaffected: its objects are
// stamped 'prod' and only ever reach the production webhook.
// Run: node app/functions/_lib/__tests__/stripe-webhook-environment-gate.test.mjs
import assert from 'node:assert';
import { onRequest } from '../../api/stripe-webhook.js';
import {
  canonicalEnvironmentName, canonicalizeEnvironmentStamp, environmentStampFields,
  eventEnvironmentStamp, isForeignEnvironmentStamp
} from '../stripe-environment.js';
import { buildUpgradeCheckoutSessionBody } from '../billing-ownership.js';
import {
  createFakeD1, createFakeKV, makeEnv, makeEvent, makeSubscription,
  postWebhook, stubStripeFetch
} from './billing-test-helper.mjs';

const START = 1755000000, END = 1757678400;
const devEnv = (over = {}) => makeEnv({ ENVIRONMENT: 'dev', STRIPE_SECRET_KEY: 'sk_test_fake', FRONTEND_URL: 'https://dev.jobhackai.io', ...over });
const user = (over = {}) => ({
  id: 1, auth_id: 'uid_E', email: 'e@example.com', plan: 'free',
  stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null,
  trial_ends_at: null, current_period_start: null, current_period_end: null,
  cancel_at: null, scheduled_plan: null, scheduled_at: null,
  has_ever_paid: 0, plan_updated_at: '2020-01-01T00:00:00.000Z',
  voice_sessions_remaining: 0, free_session_used: 0, pack_expires_at: null, ...over
});
const cusStub = { match: '/v1/customers/cus_E', reply: { json: { id: 'cus_E', email: 'e@example.com', metadata: { firebaseUid: 'uid_E' } } } };

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); process.exitCode = 1; }
}

console.log('stripe-webhook environment-gate suite\n');

await test('canonical names: PROD/production → prod, development → dev, qa → qa, unknown → null; stamps canonicalize the same way', () => {
  assert.strictEqual(canonicalEnvironmentName({ ENVIRONMENT: 'PROD' }), 'prod');
  assert.strictEqual(canonicalEnvironmentName({ ENVIRONMENT: 'production' }), 'prod');
  assert.strictEqual(canonicalEnvironmentName({ ENVIRONMENT: ' Development ' }), 'dev');
  assert.strictEqual(canonicalEnvironmentName({ ENVIRONMENT: 'qa' }), 'qa');
  assert.strictEqual(canonicalEnvironmentName({ ENVIRONMENT: 'staging' }), null);
  assert.strictEqual(canonicalizeEnvironmentStamp('Production'), 'prod');
  assert.strictEqual(canonicalizeEnvironmentStamp(''), null);
  assert.strictEqual(canonicalizeEnvironmentStamp(undefined), null);
  assert.strictEqual(canonicalizeEnvironmentStamp('staging'), 'staging', 'unknown stamps stay foreign');
  assert.strictEqual(isForeignEnvironmentStamp({ ENVIRONMENT: 'dev' }, null), false, 'un-stamped is never foreign');
  assert.strictEqual(isForeignEnvironmentStamp({ ENVIRONMENT: 'dev' }, 'dev'), false);
  assert.strictEqual(isForeignEnvironmentStamp({ ENVIRONMENT: 'dev' }, 'qa'), true);
  assert.strictEqual(isForeignEnvironmentStamp({ ENVIRONMENT: 'PROD' }, 'prod'), false, 'PROD deployment recognises its own prod stamp');
  assert.strictEqual(isForeignEnvironmentStamp({ ENVIRONMENT: 'PROD' }, 'production'), false);
});

await test('checkout bodies carry the stamp: session always, subscription_data only in subscription mode', () => {
  assert.deepStrictEqual(environmentStampFields({ ENVIRONMENT: 'dev' }, { subscription: true }),
    { 'metadata[environment]': 'dev', 'subscription_data[metadata][environment]': 'dev' });
  assert.deepStrictEqual(environmentStampFields({ ENVIRONMENT: 'qa' }, { subscription: false }), { 'metadata[environment]': 'qa' });
  assert.deepStrictEqual(environmentStampFields({ ENVIRONMENT: 'weird' }), {}, 'unknown environment stamps nothing (the mode gate already fails closed there)');
  const body = buildUpgradeCheckoutSessionBody({ ENVIRONMENT: 'PROD' }, { uid: 'u', customerId: 'cus_1', priceId: 'p', targetPlan: 'pro', returnUrl: 'https://x', source: 's' });
  assert.strictEqual(body['metadata[environment]'], 'prod');
  assert.strictEqual(body['subscription_data[metadata][environment]'], 'prod');
  assert.strictEqual(body['subscription_data[metadata][firebaseUid]'], 'u', 'existing ownership stamp preserved');
});

await test('eventEnvironmentStamp reads session/subscription metadata and the invoice subscription snapshot', () => {
  assert.strictEqual(eventEnvironmentStamp({ data: { object: { metadata: { environment: 'QA' } } } }), 'qa');
  assert.strictEqual(eventEnvironmentStamp({ data: { object: { subscription_details: { metadata: { environment: 'dev' } } } } }), 'dev');
  assert.strictEqual(eventEnvironmentStamp({ data: { object: { metadata: {} } } }), null);
  assert.strictEqual(eventEnvironmentStamp({}), null);
});

await test('dev ignores a QA-stamped pack checkout: 200 [ignored-other-environment], zero D1/KV writes, no ledger row, no user row', async () => {
  const db = createFakeD1({ users: [] });
  const kv = createFakeKV();
  const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
  const session = { id: 'cs_qa_pack', mode: 'payment', status: 'complete', payment_status: 'paid', customer: 'cus_E', metadata: { plan: 'pack', firebaseUid: 'uid_E', environment: 'qa' } };
  const event = makeEvent('checkout.session.completed', session, { livemode: false });
  const res = await postWebhook(onRequest, env, event); // no fetch stub needed: nothing is fetched
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), '[ignored-other-environment]');
  assert.strictEqual(db.__state.writes, 0);
  assert.strictEqual(kv.writeCount, 0);
  assert.strictEqual(db.ledgerRow(event.id), null);
  assert.strictEqual(db.usersByAuthId('uid_E'), null, 'no dev row created for a QA purchase');
});

await test('dev ignores QA-stamped subscription events, but processes its own and un-stamped ones', async () => {
  const base = () => ({ db: createFakeD1({ users: [user()] }), kv: createFakeKV() });
  // foreign
  {
    const { db, kv } = base();
    const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
    const sub = makeSubscription({ id: 'sub_qa', customer: 'cus_E', priceId: 'price_monthly_test', metadata: { firebaseUid: 'uid_E', environment: 'qa' }, itemPeriodStart: START, itemPeriodEnd: END });
    const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.created', sub, { livemode: false }));
    assert.strictEqual(await res.text(), '[ignored-other-environment]');
    assert.strictEqual(db.__state.writes, 0);
    assert.strictEqual(db.usersByAuthId('uid_E').plan, 'free');
  }
  // own stamp
  {
    const { db, kv } = base();
    const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
    const stub = stubStripeFetch([cusStub]);
    const sub = makeSubscription({ id: 'sub_dev', customer: 'cus_E', priceId: 'price_monthly_test', metadata: { firebaseUid: 'uid_E', environment: 'development' }, itemPeriodStart: START, itemPeriodEnd: END });
    const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.created', sub, { livemode: false }));
    stub.restore();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(db.usersByAuthId('uid_E').plan, 'monthly');
  }
  // un-stamped (legacy / dashboard / stripe trigger)
  {
    const { db, kv } = base();
    const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
    const stub = stubStripeFetch([cusStub]);
    const sub = makeSubscription({ id: 'sub_legacy', customer: 'cus_E', priceId: 'price_weekly_test', metadata: { firebaseUid: 'uid_E' }, itemPeriodStart: START, itemPeriodEnd: END });
    const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.created', sub, { livemode: false }));
    stub.restore();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(db.usersByAuthId('uid_E').plan, 'weekly');
  }
});

await test('invoice.payment_failed: foreign stamp on the payload is ignored pre-claim; foreign stamp only on the fetched subscription is a recorded no-op', async () => {
  // payload snapshot carries the stamp → zero writes, no ledger row
  {
    const db = createFakeD1({ users: [user({ plan: 'monthly', subscription_status: 'active', stripe_subscription_id: 'sub_qa2' })] });
    const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
    const invoice = { id: 'in_qa', customer: 'cus_E', subscription: 'sub_qa2', subscription_details: { metadata: { environment: 'qa' } } };
    const event = makeEvent('invoice.payment_failed', invoice, { livemode: false });
    const res = await postWebhook(onRequest, env, event);
    assert.strictEqual(await res.text(), '[ignored-other-environment]');
    assert.strictEqual(db.__state.writes, 0);
    assert.strictEqual(db.ledgerRow(event.id), null);
  }
  // no snapshot on the payload; the fetched subscription is QA's → no-op after the claim, no users write
  {
    const db = createFakeD1({ users: [user({ plan: 'monthly', subscription_status: 'active', stripe_subscription_id: 'sub_qa3' })] });
    const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
    const stub = stubStripeFetch([cusStub, { match: '/v1/subscriptions/sub_qa3', reply: { json: makeSubscription({ id: 'sub_qa3', customer: 'cus_E', status: 'past_due', priceId: 'price_monthly_test', metadata: { firebaseUid: 'uid_E', environment: 'qa' } }) } }]);
    const event = makeEvent('invoice.payment_failed', { id: 'in_qa3', customer: 'cus_E', subscription: 'sub_qa3' }, { livemode: false });
    const res = await postWebhook(onRequest, env, event);
    stub.restore();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(db.usersByAuthId('uid_E').subscription_status, 'active', 'dunning status of another environment\'s subscription is not written here');
    assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
  }
});

await test('production processes its own prod-stamped live objects (PROD deployment name)', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = makeEnv({ ENVIRONMENT: 'PROD', DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub]);
  const sub = makeSubscription({ id: 'sub_live', customer: 'cus_E', priceId: 'price_pro_test', metadata: { firebaseUid: 'uid_E', environment: 'prod' }, itemPeriodStart: START, itemPeriodEnd: END });
  const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.created', sub, { livemode: true }));
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_E').plan, 'pro');
});

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
