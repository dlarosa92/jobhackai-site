import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkoutCancelUrl } from '../checkout-return.js';

test('voice checkout leaves the retired experiment and retains the environment and query', () => {
  for (const plan of ['weekly', 'monthly', 'pack']) {
    for (const path of ['/pricing-a', '/pricing-a.html', '/pricing-a/']) {
      assert.equal(checkoutCancelUrl({ STRIPE_CANCEL_URL: `https://qa.jobhackai.io${path}?canceled=1&utm_campaign=fixture#offers` }, plan),
        'https://qa.jobhackai.io/pricing?canceled=1&utm_campaign=fixture#offers');
    }
  }
});
test('existing plans and explicitly configured custom return routes remain intact', () => {
  const legacy = 'https://dev.jobhackai.io/pricing-a?canceled=1';
  assert.equal(checkoutCancelUrl({ STRIPE_CANCEL_URL: legacy }, 'pro'), legacy);
  const custom = 'https://qa.jobhackai.io/account-setting.html?canceled=1';
  assert.equal(checkoutCancelUrl({ STRIPE_CANCEL_URL: custom }, 'pack'), custom);
  assert.equal(checkoutCancelUrl({ FRONTEND_URL: 'https://qa.jobhackai.io' }, 'weekly'), 'https://qa.jobhackai.io/pricing');
});
