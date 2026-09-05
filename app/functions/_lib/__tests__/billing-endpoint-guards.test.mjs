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
import { resolveCustomerByEmailOwnership, buildUpgradeCheckoutSessionBody, selectSubscriptionsToCancel } from '../billing-ownership.js';
import { cacheCustomerId, statusRank, pickBestSubscription } from '../billing-utils.js';
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

// (PR #852 review) EVERY un-stamped match is scanned, not just the first ten:
// an entitled subscription on the 12th customer must still block.
{
  const legacy = Array.from({ length: 12 }, (_, i) => ({ id: `cus_lx${String(i + 1).padStart(2, '0')}`, created: i, metadata: {} }));
  const stub = stubStripeFetch([
    searchRoute([ownedCus, ...legacy]),
    ...legacy.map((c, i) => subsRoute(c.id, i === 11 ? ['active'] : ['canceled']))
  ]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.block?.status, 409, 'an entitled subscription beyond the 10th un-stamped customer must still block');
}

// past_due / trialing / unpaid on the un-stamped customer block too —
// 'unpaid' included (Bugbot round 2): the webhook keeps the plan through
// unpaid dunning, so it is still a double-billing risk at checkout.
for (const status of ['past_due', 'trialing', 'unpaid']) {
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

// (Bugbot round 2) An 'unpaid' subscription also marks the entitled owned
// customer — the newer empty one must not win.
{
  const owned2 = { id: 'cus_owned2', created: 200, metadata: { firebaseUid: 'uid_A' } };
  const stub = stubStripeFetch([
    searchRoute([ownedCus, owned2]),
    subsRoute('cus_owned', ['unpaid']),
    subsRoute('cus_owned2', [])
  ]);
  const r = await resolveCustomerByEmailOwnership(ENV, 'uid_A', 'a@example.com');
  stub.restore();
  assert.strictEqual(r.matchedCustomer?.id, 'cus_owned', 'unpaid counts as the entitled subscription');
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

// ── (PR #855 review) 'unpaid' ranks as entitled dunning, above ended statuses ──
{
  assert.ok(statusRank('active') > statusRank('trialing'), 'active > trialing');
  assert.ok(statusRank('trialing') > statusRank('past_due'), 'trialing > past_due');
  assert.ok(statusRank('past_due') > statusRank('unpaid'), 'past_due > unpaid');
  assert.ok(statusRank('unpaid') > statusRank('canceled') && statusRank('unpaid') > statusRank('incomplete_expired'), 'unpaid outranks ended/unknown statuses');
  // Same plan, newer non-entitled sub: the unpaid one must still be chosen
  // (previously both ranked 0 and creation date decided).
  const unpaid = { id: 'sub_unpaid', status: 'unpaid', created: 100 };
  const newerEnded = { id: 'sub_ended', status: 'incomplete_expired', created: 200 };
  assert.strictEqual(pickBestSubscription([newerEnded, unpaid], ENV).bestSub.id, 'sub_unpaid', 'an unpaid subscription beats a newer non-entitled one');
}

// ── (PR #855 review, Bugbot scenario) higher-plan unpaid + lower-plan past_due/trialing ──
// Policy: status before plan. The survivor is the subscription Stripe is still
// collecting on; upgrade-plan then moves it to the requested plan and cancels
// the rest. Ranking unpaid at/above past_due would make the unpaid Premium
// "current" and an upgrade request would hit ALREADY_ON_PLAN / the downgrade
// path, leaving both subscriptions alive.
{
  const PRICE_ENV = { ...ENV, STRIPE_PRICE_ESSENTIAL_MONTHLY: 'price_ess', STRIPE_PRICE_PRO_MONTHLY: 'price_pro', STRIPE_PRICE_PREMIUM_MONTHLY: 'price_prem' };
  const sub = (id, status, priceId, created) => ({ id, status, created, items: { data: [{ price: { id: priceId } }] } });
  const premiumUnpaid = sub('sub_prem_unpaid', 'unpaid', 'price_prem', 300);
  const essentialPastDue = sub('sub_ess_past_due', 'past_due', 'price_ess', 100);
  const essentialTrialing = sub('sub_ess_trialing', 'trialing', 'price_ess', 100);
  const essentialActive = sub('sub_ess_active', 'active', 'price_ess', 100);

  for (const [label, lower] of [['past_due', essentialPastDue], ['trialing', essentialTrialing], ['active', essentialActive]]) {
    const { bestSub, currentPlan } = pickBestSubscription([premiumUnpaid, lower], PRICE_ENV);
    assert.strictEqual(bestSub.id, lower.id, `lower-plan ${label} survives over higher-plan unpaid`);
    assert.strictEqual(currentPlan, 'essential', 'current plan follows the survivor, so an upgrade request proceeds instead of ALREADY_ON_PLAN');
    const cancel = selectSubscriptionsToCancel([premiumUnpaid, lower], bestSub.id);
    assert.deepStrictEqual(cancel.map((s) => s.id), ['sub_prem_unpaid'], `only the unpaid duplicate is cancelled (${label} case)`);
  }
  // Plan still breaks ties WITHIN a status: two unpaid subs → keep the higher plan.
  const essentialUnpaid = sub('sub_ess_unpaid', 'unpaid', 'price_ess', 400);
  assert.strictEqual(pickBestSubscription([essentialUnpaid, premiumUnpaid], PRICE_ENV).bestSub.id, 'sub_prem_unpaid', 'same status → higher plan wins');
  // Ended subscriptions are never in the cancellation set.
  const canceledPremium = sub('sub_prem_canceled', 'canceled', 'price_prem', 500);
  assert.deepStrictEqual(selectSubscriptionsToCancel([essentialActive, canceledPremium, premiumUnpaid], 'sub_ess_active').map((s) => s.id), ['sub_prem_unpaid']);
}

console.log('billing-endpoint-guards.test.mjs: all assertions passed');
