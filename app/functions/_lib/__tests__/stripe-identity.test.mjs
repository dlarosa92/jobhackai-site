// Owner resolution, cross-user guard, and ownership-proven customer
// selection (unit level; the webhook e2e suite covers the wired behavior).
import assert from 'node:assert';
import {
  resolveOwnerUid,
  assertNoCrossUserStripeIds,
  selectUidOwnedCustomers,
  partitionCustomersByUidClaim,
  TransientStripeError
} from '../stripe-identity.js';
import { createFakeD1, stubStripeFetch } from './billing-test-helper.mjs';

const ENV = { STRIPE_SECRET_KEY: 'sk_live_x' };
const customerReply = (uid, email = 'user@example.com') => ({ json: { id: 'cus_abc', email, metadata: uid ? { firebaseUid: uid } : {} } });

// 1. Subscription metadata wins when present (no customer fetch needed).
{
  const stub = stubStripeFetch([{ match: '/v1/customers/', reply: customerReply('uid_A') }]);
  const r = await resolveOwnerUid(ENV, { subscription: { metadata: { firebaseUid: 'uid_A' } }, customerId: 'cus_abc' });
  assert.strictEqual(r.uid, 'uid_A');
  assert.strictEqual(r.conflict, false);
  assert.strictEqual(r.source, 'subscription');
  stub.restore();
}

// 2. Session metadata resolves when subscription metadata is absent.
{
  const stub = stubStripeFetch([{ match: '/v1/customers/', reply: customerReply(null) }]);
  const r = await resolveOwnerUid(ENV, { session: { metadata: { firebaseUid: 'uid_B' } }, customerId: 'cus_abc' });
  assert.strictEqual(r.uid, 'uid_B');
  assert.strictEqual(r.conflict, false);
  stub.restore();
}

// 3. Customer metadata resolves when it is the only source.
{
  const stub = stubStripeFetch([{ match: '/v1/customers/', reply: customerReply('uid_C') }]);
  const r = await resolveOwnerUid(ENV, { customerId: 'cus_abc' });
  assert.strictEqual(r.uid, 'uid_C');
  assert.strictEqual(r.source, 'customer');
  stub.restore();
}

// 4. Conflicting sources → no owner, conflict flagged, no guessing.
{
  const stub = stubStripeFetch([{ match: '/v1/customers/', reply: customerReply('uid_OTHER') }]);
  const r = await resolveOwnerUid(ENV, { subscription: { metadata: { firebaseUid: 'uid_A' } }, customerId: 'cus_abc' });
  assert.strictEqual(r.uid, null);
  assert.strictEqual(r.conflict, true);
  stub.restore();
}

// 5. Customer 404 (missing in this mode) exhausts the source, not an error.
{
  const stub = stubStripeFetch([{ match: '/v1/customers/', reply: { status: 404, json: { error: { message: 'No such customer' } } } }]);
  const r = await resolveOwnerUid(ENV, { customerId: 'cus_abc' });
  assert.strictEqual(r.uid, null);
  assert.strictEqual(r.conflict, false);
  stub.restore();
}

// 6. Customer 5xx with NO other source → TransientStripeError (retryable).
{
  const stub = stubStripeFetch([{ match: '/v1/customers/', reply: { status: 500, json: {} } }]);
  await assert.rejects(
    () => resolveOwnerUid(ENV, { customerId: 'cus_abc' }),
    (err) => err instanceof TransientStripeError
  );
  stub.restore();
}

// 7. Customer 5xx WITH a trusted source already resolved → non-fatal.
{
  const stub = stubStripeFetch([{ match: '/v1/customers/', reply: { status: 500, json: {} } }]);
  const r = await resolveOwnerUid(ENV, { subscription: { metadata: { firebaseUid: 'uid_A' } }, customerId: 'cus_abc' });
  assert.strictEqual(r.uid, 'uid_A');
  stub.restore();
}

// 8. Malformed uids are rejected (whitespace, control chars, oversized).
{
  const r = await resolveOwnerUid(ENV, { subscription: { metadata: { firebaseUid: 'bad uid' } } });
  assert.strictEqual(r.uid, null);
  const r2 = await resolveOwnerUid(ENV, { subscription: { metadata: { firebaseUid: 'x'.repeat(200) } } });
  assert.strictEqual(r2.uid, null);
}

// 9. Cross-user guard: duplicate customer id on another row blocks the write.
{
  const db = createFakeD1({ users: [
    { id: 1, auth_id: 'uid_A', stripe_customer_id: 'cus_dup', stripe_subscription_id: 'sub_1' },
    { id: 2, auth_id: 'uid_B', stripe_customer_id: null, stripe_subscription_id: null }
  ] });
  const guard = await assertNoCrossUserStripeIds({ DB: db }, { uid: 'uid_B', stripeCustomerId: 'cus_dup', stripeSubscriptionId: 'sub_new' });
  assert.strictEqual(guard.ok, false);
  assert.strictEqual(guard.conflictRowId, 1);

  const own = await assertNoCrossUserStripeIds({ DB: db }, { uid: 'uid_A', stripeCustomerId: 'cus_dup', stripeSubscriptionId: 'sub_1' });
  assert.strictEqual(own.ok, true, 'a user re-attaching their own ids is fine');

  const clean = await assertNoCrossUserStripeIds({ DB: db }, { uid: 'uid_B', stripeCustomerId: 'cus_new', stripeSubscriptionId: null });
  assert.strictEqual(clean.ok, true);
}

// 10. Duplicate subscription id alone also blocks.
{
  const db = createFakeD1({ users: [
    { id: 1, auth_id: 'uid_A', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_dup' }
  ] });
  const guard = await assertNoCrossUserStripeIds({ DB: db }, { uid: 'uid_B', stripeCustomerId: 'cus_2', stripeSubscriptionId: 'sub_dup' });
  assert.strictEqual(guard.ok, false);
}

// 11. selectUidOwnedCustomers: exact-uid matches only; un-stamped and
//     foreign customers are never selected.
{
  const customers = [
    { id: 'cus_owned', metadata: { firebaseUid: 'uid_A' } },
    { id: 'cus_unstamped', metadata: {} },
    { id: 'cus_foreign', metadata: { firebaseUid: 'uid_B' } },
    { id: 'cus_deleted', deleted: true, metadata: { firebaseUid: 'uid_A' } }
  ];
  const owned = selectUidOwnedCustomers(customers, 'uid_A');
  assert.deepStrictEqual(owned.map((c) => c.id), ['cus_owned']);
  assert.deepStrictEqual(selectUidOwnedCustomers(customers, null), []);
  assert.deepStrictEqual(selectUidOwnedCustomers([], 'uid_A'), []);
}

// 12. partitionCustomersByUidClaim splits owned / unproven / foreign.
{
  const { owned, unproven, foreign } = partitionCustomersByUidClaim([
    { id: 'c1', metadata: { firebaseUid: 'uid_A' } },
    { id: 'c2', metadata: {} },
    { id: 'c3' },
    { id: 'c4', metadata: { firebaseUid: 'uid_B' } },
    { id: 'c5', deleted: true }
  ], 'uid_A');
  assert.deepStrictEqual(owned.map((c) => c.id), ['c1']);
  assert.deepStrictEqual(unproven.map((c) => c.id), ['c2', 'c3']);
  assert.deepStrictEqual(foreign.map((c) => c.id), ['c4']);
}

console.log('stripe-identity.test.mjs: all assertions passed');
