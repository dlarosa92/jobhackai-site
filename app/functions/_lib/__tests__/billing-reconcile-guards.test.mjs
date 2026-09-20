// Reconciliation CLI guards (pure functions from the core module):
//   * credential MODE per target environment — prod needs a live key,
//     qa/dev need a test key; missing/mismatched keys are refused before any
//     network access, and the error text never echoes the key
//   * rollback ORDERING — restoring before-images that re-introduce duplicate
//     Stripe ids is detected so the CLI refuses while 023's unique indexes
//     exist, with the exact drop-indexes-first instruction
// Run: node app/functions/_lib/__tests__/billing-reconcile-guards.test.mjs
import assert from 'node:assert';
import {
  assertCredentialModeForEnv, findRollbackIdCollisions, ROLLBACK_ORDER_INSTRUCTIONS,
  assertSafeStripeAccountId, assertStripeAccountMatches, notFoundSignal
} from '../../../scripts/lib/billing-reconcile-core.mjs';

// ── credential mode matrix (fake keys only) ──
// Short, unmistakable fixtures exercise only the mode prefix. They are not
// credentials and cannot be used for Stripe requests.
const FAKE = {
  skLive: 'sk_live_fixture',
  rkLive: 'rk_live_fixture',
  skTest: 'sk_test_fixture',
  rkTest: 'rk_test_fixture',
  pkTest: 'pk_test_fixture',
  junk: 'not-a-stripe-key'
};
const accepts = (env, key) => assert.deepStrictEqual(assertCredentialModeForEnv(env, key), { mode: env === 'prod' ? 'live' : 'test' }, `${env} must accept ${key.slice(0, 8)}…`);
const rejects = (env, key, re) => {
  assert.throws(() => assertCredentialModeForEnv(env, key), (err) => {
    assert.match(err.message, re);
    if (key) assert.ok(!err.message.includes(key.slice(8)), 'error text must never echo the key material');
    return true;
  }, `${env} must reject ${String(key).slice(0, 8)}…`);
};

accepts('prod', FAKE.skLive);
accepts('prod', FAKE.rkLive);
rejects('prod', FAKE.skTest, /not a live-mode key/);
rejects('prod', FAKE.rkTest, /not a live-mode key/);
rejects('prod', FAKE.pkTest, /not a live-mode key/);
rejects('prod', FAKE.junk, /not a live-mode key/);
rejects('prod', '', /required/);
rejects('prod', undefined, /required/);
for (const env of ['qa', 'dev']) {
  accepts(env, FAKE.skTest);
  accepts(env, FAKE.rkTest);
  rejects(env, FAKE.skLive, /not a test-mode key/);
  rejects(env, FAKE.rkLive, /not a test-mode key/);
  rejects(env, FAKE.pkTest, /not a test-mode key/);
  rejects(env, '', /required/);
}
assert.throws(() => assertCredentialModeForEnv('staging', FAKE.skTest), /unknown --env/);

// ── rollback ordering guard ──
const audit = (userRowId, oldCus, oldSub, mode = 'apply') => ({
  mode, user_row_id: userRowId, auth_id: `uid_${userRowId}`,
  old_values_json: JSON.stringify({ stripe_customer_id: oldCus, stripe_subscription_id: oldSub, plan: 'pro' }),
  new_values_json: JSON.stringify({ plan: 'free' })
});
// Rows 128 (kept, LEGIT) and 161 (repaired: ids cleared) once shared cus_dup1E7V.
const current = [
  { id: 128, stripe_customer_id: 'cus_dup1E7V', stripe_subscription_id: 'sub_128' },
  { id: 161, stripe_customer_id: null, stripe_subscription_id: null },
  { id: 134, stripe_customer_id: null, stripe_subscription_id: null },
  { id: 144, stripe_customer_id: null, stripe_subscription_id: null },
  { id: 40, stripe_customer_id: 'cus_40', stripe_subscription_id: 'sub_40' }
];
{
  const collisions = findRollbackIdCollisions([audit(161, 'cus_dup1E7V', 'sub_161'), audit(134, 'cus_dup8IW8', 'sub_134'), audit(144, 'cus_dup8IW8', null)], current);
  assert.deepStrictEqual(collisions, [
    { field: 'stripe_customer_id', valueLast4: '1E7V', rowIds: [128, 161] },
    { field: 'stripe_customer_id', valueLast4: '8IW8', rowIds: [134, 144] }
  ]);
  assert.ok(!JSON.stringify(collisions).includes('cus_dup1E7V'), 'report carries last-4 only');
}
// A rollback that re-introduces no duplicates is not a collision (unique indexes may stay).
assert.deepStrictEqual(findRollbackIdCollisions([audit(40, 'cus_40', 'sub_40')], current), []);
assert.deepStrictEqual(findRollbackIdCollisions([audit(161, null, null)], current), []);
// Rollback audit rows are ignored (only apply before-images are restored).
assert.deepStrictEqual(findRollbackIdCollisions([audit(161, 'cus_dup1E7V', 'sub_161', 'rollback')], current), []);
// Subscription-id collisions are detected too.
assert.deepStrictEqual(findRollbackIdCollisions([audit(161, null, 'sub_40')], current), [{ field: 'stripe_subscription_id', valueLast4: 'b_40', rowIds: [40, 161] }]);
// The instruction text carries the ordering: code → drop 023 indexes → data rollback → keep 022.
const text = ROLLBACK_ORDER_INSTRUCTIONS.join('\n');
assert.ok(text.indexOf('CODE back first') < text.indexOf('DROP INDEX IF EXISTS idx_users_stripe_customer_id_unique'));
assert.ok(text.indexOf('DROP INDEX IF EXISTS idx_users_stripe_subscription_id_unique') < text.indexOf('re-run this --rollback'));
assert.ok(text.indexOf('re-run this --rollback') < text.indexOf('keep migration 022'));

// ── Stripe account pin ──
assert.strictEqual(assertSafeStripeAccountId('acct_1RymDCApMPhcB1Y6'), 'acct_1RymDCApMPhcB1Y6');
assert.throws(() => assertSafeStripeAccountId('acct_1; DROP'), /acct_/);
assert.throws(() => assertSafeStripeAccountId(''), /acct_/);
assert.strictEqual(assertStripeAccountMatches('acct_shared', 'acct_shared'), 'acct_shared');
assert.throws(() => assertStripeAccountMatches('acct_shared', 'acct_sandbox'), /belongs to Stripe account acct_sandbox but --stripe-account expects acct_shared/);
assert.throws(() => assertStripeAccountMatches('acct_shared', undefined), /could not read the Stripe account identity/);

// ── cross-account 404 signal ──
const st = (subFound, cusFound) => ({ subscription: subFound === null ? null : { found: subFound }, customer: cusFound === null ? null : { found: cusFound } });
// Every object found → no signal.
assert.deepStrictEqual(notFoundSignal({ 1: st(true, true), 2: st(true, true), 3: st(null, true) }), { checked: 5, notFound: 0, ratio: 0, massNotFound: false });
// A cross-account run: (almost) everything missing.
assert.deepStrictEqual(notFoundSignal({ 1: st(false, false), 2: st(false, false), 3: st(false, true) }).massNotFound, true);
// The real dev preflight shape (a handful of stale objects among many valid ones) is NOT a mass signal.
{
  const state = {};
  for (let i = 1; i <= 30; i++) state[i] = st(i <= 4 ? false : (i <= 10 ? true : null), i <= 20);
  const sig = notFoundSignal(state);
  assert.strictEqual(sig.massNotFound, false);
  assert.ok(sig.checked > 20);
}
// Too few objects to judge → no signal even when all are missing (threshold needs ≥5 checks).
assert.strictEqual(notFoundSignal({ 1: st(false, false), 2: st(false, null) }).massNotFound, false);
assert.strictEqual(notFoundSignal({}).checked, 0);

console.log('billing-reconcile-guards.test.mjs: all assertions passed');
