// Environment/mode resolution matrix — fully fail-closed semantics (R2-2):
// only explicit prod/production (live) and qa/dev/development (test) process
// Stripe activity; anything else is a config error EVEN WITH A LIVE KEY.
import assert from 'node:assert';
import {
  normalizeEnvironmentName,
  keyMode,
  resolveExpectedLivemode,
  assertStripeKeyMatchesEnvironment,
  redactId
} from '../stripe-environment.js';

const cases = [
  // [ENVIRONMENT, STRIPE_SECRET_KEY, expected, configError]
  ['prod', 'sk_live_x', true, false],
  ['PROD', 'sk_live_x', true, false],
  ['  Production ', 'sk_live_x', true, false],
  ['production', 'rk_live_x', true, false],
  ['qa', 'sk_test_x', false, false],
  ['dev', 'sk_test_x', false, false],
  ['development', 'rk_test_x', false, false],
  ['QA', 'sk_test_x', false, false],
  // Fail-closed: unknown/missing env is a config error regardless of key.
  ['', 'sk_live_x', null, true],
  [undefined, 'sk_live_x', null, true],
  ['prodd', 'sk_live_x', null, true],
  ['staging', 'sk_test_x', null, true],
  ['', 'sk_test_x', null, true],
  ['', '', null, true]
];

for (const [environment, key, expected, configError] of cases) {
  const env = { ENVIRONMENT: environment, STRIPE_SECRET_KEY: key };
  const r = resolveExpectedLivemode(env);
  assert.strictEqual(r.configError ?? false, configError, `configError for env=${JSON.stringify(environment)} key=${key}`);
  assert.strictEqual(r.expected, expected, `expected livemode for env=${JSON.stringify(environment)} key=${key}`);
}

// The live-key fallback is gone: unknown env + live key must NOT resolve.
assert.strictEqual(resolveExpectedLivemode({ ENVIRONMENT: 'unknown', STRIPE_SECRET_KEY: 'sk_live_x' }).configError, true,
  'unknown env with live key must be a config error (no key-based inference)');

// keyMode
assert.strictEqual(keyMode({ STRIPE_SECRET_KEY: 'sk_live_abc' }), 'live');
assert.strictEqual(keyMode({ STRIPE_SECRET_KEY: 'rk_live_abc' }), 'live');
assert.strictEqual(keyMode({ STRIPE_SECRET_KEY: 'sk_test_abc' }), 'test');
assert.strictEqual(keyMode({ STRIPE_SECRET_KEY: 'rk_test_abc' }), 'test');
assert.strictEqual(keyMode({ STRIPE_SECRET_KEY: 'pk_live_abc' }), null);
assert.strictEqual(keyMode({}), null);

// Key↔environment assertion
assert.strictEqual(assertStripeKeyMatchesEnvironment({ ENVIRONMENT: 'prod', STRIPE_SECRET_KEY: 'sk_live_x' }).ok, true);
assert.strictEqual(assertStripeKeyMatchesEnvironment({ ENVIRONMENT: 'prod', STRIPE_SECRET_KEY: 'sk_test_x' }).ok, false, 'prod + test key must fail');
assert.strictEqual(assertStripeKeyMatchesEnvironment({ ENVIRONMENT: 'qa', STRIPE_SECRET_KEY: 'sk_live_x' }).ok, false, 'qa + live key must fail');
assert.strictEqual(assertStripeKeyMatchesEnvironment({ ENVIRONMENT: 'qa', STRIPE_SECRET_KEY: 'sk_test_x' }).ok, true);
assert.strictEqual(assertStripeKeyMatchesEnvironment({ ENVIRONMENT: 'nope', STRIPE_SECRET_KEY: 'sk_live_x' }).ok, false, 'unknown env fails regardless of key');
assert.strictEqual(assertStripeKeyMatchesEnvironment({}).ok, false, 'empty config fails');

// normalizeEnvironmentName
assert.strictEqual(normalizeEnvironmentName({ ENVIRONMENT: '  PROD ' }), 'prod');
assert.strictEqual(normalizeEnvironmentName({}), '');

// redactId never returns the full identifier
const redacted = redactId('cus_1234567890abcdef');
assert.ok(!redacted.includes('1234567890abcdef'), 'redactId must not leak the full id');
assert.ok(redacted.endsWith('cdef'), 'redactId keeps last 4 for correlation');
assert.strictEqual(redactId(''), '(none)');
assert.ok(!redactId('shortid1').includes('rtid1'), 'short ids are truncated');

console.log('stripe-environment.test.mjs: all assertions passed');
