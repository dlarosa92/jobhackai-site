// PR #851 review-round regression tests for endpoint-level guards:
//   F3 — checkout email-ownership resolution: un-stamped customers with an
//        active subscription block checkout EVEN WHEN a uid-owned customer
//        also exists (double-billing protection ordering).
//   F4 — cacheCustomerId fails CLOSED when the ownership guard errors.
//   F6 — upgrade-plan checkout sessions stamp subscription-level firebaseUid.
//
// The logic under test lives in _lib/billing-ownership.js so this suite (and
// the CI job) can run in bare Node without the firebase-auth/jose import
// chain that the endpoint entry files pull in.
import assert from 'node:assert';
import { resolveCustomerByEmailOwnership, buildUpgradeCheckoutSessionBody } from '../billing-ownership.js';
import { cacheCustomerId } from '../billing-utils.js';
import { createFakeD1, createFakeKV, stubStripeFetch } from './billing-test-helper.mjs';

const ENV = { STRIPE_SECRET_KEY: 'sk_test_x', ENVIRONMENT: 'qa' };
const ownedCus = { id: 'cus_owned', created: 100, metadata: { firebaseUid: 'uid_A' } };
const legacyCus = { id: 'cus_legacy', created: 50, metadata: {} };
const searchRoute = (data) => ({ match: '/v1/customers?email=', reply: { json: { data } } });
const subsRoute = (cusId, statuses) => ({
  match: `/v1/subscriptions?customer=${cusId}`,
  reply: { json: { data: statuses.map((status, i) => ({ id: `sub_${cusId}_${i}`, status })) } }
});

// ── F3 ───────────────────────────────────────────────────────────────────

// THE P1 case: owned customer without an active subscription + un-stamped
// customer WITH one → block, never proceed on the owned customer.
{
  const stub = stubStripeFetch([
    searchRoute([ownedCus, legacyCus]),
    subsRoute('cus_legacy', ['active'])
  ]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.ok(r.block, 'must block when an un-stamped customer has an active subscription, even with an owned match present');
  assert.strictEqual(r.block.status, 409);
  assert.strictEqual(r.block.code, 'EXISTING_SUBSCRIPTION_UNVERIFIED');
}

// past_due / trialing on the un-stamped customer block too.
for (const status of ['past_due', 'trialing']) {
  const stub = stubStripeFetch([
    searchRoute([ownedCus, legacyCus]),
    subsRoute('cus_legacy', [status])
  ]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.block?.status, 409, `${status} on un-stamped customer must block`);
}

// Owned + un-stamped with only ENDED subscriptions → owned selected, no block.
{
  const stub = stubStripeFetch([
    searchRoute([ownedCus, legacyCus]),
    subsRoute('cus_legacy', ['canceled', 'incomplete_expired'])
  ]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.block, undefined);
  assert.strictEqual(r.matchedCustomer?.id, 'cus_owned');
}

// Owned only → selected without any un-stamped scanning needed.
{
  const stub = stubStripeFetch([searchRoute([ownedCus])]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.matchedCustomer?.id, 'cus_owned');
}

// Two owned customers → the one with the active subscription wins.
{
  const owned2 = { id: 'cus_owned2', created: 200, metadata: { firebaseUid: 'uid_A' } };
  const stub = stubStripeFetch([
    searchRoute([ownedCus, owned2]),
    subsRoute('cus_owned', ['active']),
    subsRoute('cus_owned2', [])
  ]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.matchedCustomer?.id, 'cus_owned');
}

// Un-stamped with active subscription and NO owned match → still blocks.
{
  const stub = stubStripeFetch([
    searchRoute([legacyCus]),
    subsRoute('cus_legacy', ['active'])
  ]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.block?.status, 409);
}

// Un-stamped without active subs and no owned → fresh-customer path (null).
{
  const stub = stubStripeFetch([
    searchRoute([legacyCus]),
    subsRoute('cus_legacy', [])
  ]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.block, undefined);
  assert.strictEqual(r.matchedCustomer, null);
}

// Foreign-stamped customers are ignored entirely (neither owned nor scanned).
{
  const stub = stubStripeFetch([
    searchRoute([{ id: 'cus_foreign', created: 10, metadata: { firebaseUid: 'uid_OTHER' } }])
  ]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.block, undefined);
  assert.strictEqual(r.matchedCustomer, null);
}

// Search failure fails closed (503, retryable).
{
  const stub = stubStripeFetch([{ match: '/v1/customers?email=', reply: { status: 500, json: {} } }]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.block?.status, 503);
  assert.strictEqual(r.block?.code, 'OWNERSHIP_CHECK_UNAVAILABLE');
}

// Un-stamped-customer verification failure fails closed (503).
{
  const stub = stubStripeFetch([
    searchRoute([ownedCus, legacyCus]),
    { match: '/v1/subscriptions?customer=cus_legacy', reply: { status: 500, json: {} } }
  ]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.block?.status, 503, 'unverifiable un-stamped customer must fail closed even with an owned match');
}

// ── F4 ───────────────────────────────────────────────────────────────────

const guardUser = () => ({ id: 1, auth_id: 'uid_A', email: 'a@example.com', plan: 'free', stripe_customer_id: null, stripe_subscription_id: null });

// Guard EXCEPTION → fail closed: nothing cached, nothing persisted.
{
  const db = createFakeD1({ users: [guardUser()] });
  const kv = createFakeKV();
  db.failNext('stripe_customer_id IS NOT NULL', new Error('D1_ERROR: transient network failure'));
  await cacheCustomerId({ DB: db, JOBHACKAI_KV: kv }, 'uid_A', 'cus_new');
  assert.strictEqual(kv.__puts.length, 0, 'no KV write when the guard cannot run');
  assert.strictEqual(db.__state.writes, 0, 'no D1 write when the guard cannot run');
  assert.ok(!db.usersByAuthId('uid_A').stripe_customer_id, 'customer id not attached');
}

// Guard REFUSAL (id held by another user) → fail closed.
{
  const db = createFakeD1({ users: [
    guardUser(),
    { id: 2, auth_id: 'uid_B', stripe_customer_id: 'cus_taken', stripe_subscription_id: null }
  ] });
  const kv = createFakeKV();
  await cacheCustomerId({ DB: db, JOBHACKAI_KV: kv }, 'uid_A', 'cus_taken');
  assert.strictEqual(kv.__puts.length, 0);
  assert.ok(!db.usersByAuthId('uid_A').stripe_customer_id);
}

// Positive control: clean guard → id cached in KV and persisted to D1.
{
  const db = createFakeD1({ users: [guardUser()] });
  const kv = createFakeKV();
  await cacheCustomerId({ DB: db, JOBHACKAI_KV: kv }, 'uid_A', 'cus_new');
  assert.ok(kv.__puts.includes('cusByUid:uid_A'), 'KV cached on clean guard');
  assert.strictEqual(db.usersByAuthId('uid_A').stripe_customer_id, 'cus_new');
}

// ── F6 ───────────────────────────────────────────────────────────────────

{
  const body = buildUpgradeCheckoutSessionBody({}, {
    uid: 'uid_A', customerId: 'cus_1', priceId: 'price_pro',
    targetPlan: 'pro', returnUrl: 'https://app.jobhackai.io/account', source: 'test'
  });
  assert.strictEqual(body.mode, 'subscription');
  assert.strictEqual(body.customer, 'cus_1');
  assert.strictEqual(body['metadata[firebaseUid]'], 'uid_A', 'session-level uid metadata kept');
  assert.strictEqual(body['subscription_data[metadata][firebaseUid]'], 'uid_A',
    'the subscription itself must carry firebaseUid so customer.subscription.* events resolve ownership');
  assert.strictEqual(body['line_items[0][price]'], 'price_pro');
  assert.strictEqual(body['metadata[plan]'], 'pro');
}

console.log('billing-endpoint-guards.test.mjs: all assertions passed');
