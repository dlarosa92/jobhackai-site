import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { saveCheckoutAttribution } from '../checkout-attribution.js';
import { accountOperationEnv } from '../account-operation-scope.js';
import { assertStripeKeyMatchesEnvironment, redactId } from '../stripe-environment.js';
import { readSubscriptionPeriod } from '../stripe-identity.js';
import { planToPrice, priceIdToPlan, planRank, pickBestSubscription, kvCusKey } from '../billing-utils.js';
import { buildUpgradeCheckoutSessionBody, selectSubscriptionsToCancel, ENTITLED_SUBSCRIPTION_STATUSES } from '../billing-ownership.js';

const root = new URL('../../../../', import.meta.url);
const clientSource = readFileSync(new URL('js/stripe-integration.js', root), 'utf8');
const clientFunction = clientSource.slice(clientSource.indexOf('async function upgradePlan('), clientSource.indexOf('\nwindow.upgradePlan ='));
const routeSource = readFileSync(new URL('../../api/upgrade-plan.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../db/migrations/025_checkout_attribution.sql', import.meta.url), 'utf8');
const clientId = '7bbba230-b755-4d31-b475-e20cf6d00ed9';
const quiet = { log() {}, warn() {}, error() {} };
function analytics() {
  const touch = { at: Date.now() - 1000, source: 'linkedin', medium: 'organic_social', campaign: 'voice_beta_2026_09', asset: 'launch_01' };
  return { analyticsConsent: true, gaClientId: '1234.5678', gaSessionId: '9876', firstTouch: touch, lastTouch: touch };
}

// Execute the actual shared click flow, replacing only browser/auth/network
// boundaries. Analytics failure must never prevent the approved billing action.
function clientHarness({ context = analytics(), missing = false, throws = false, confirmed = true } = {}) {
  const calls = [], events = [], lookups = [];
  const ctx = vm.createContext({ console: quiet,
    localStorage: { getItem: () => 'weekly' },
    requestUpgradeConfirmation: async () => confirmed,
    window: { location: { href: 'https://qa.jobhackai.io/pricing' },
      FirebaseAuthManager: { getCurrentUser: () => ({ getIdToken: async () => 'fixture-token' }) },
      JHA: { trackEventSafe: (...args) => events.push(args), ...(missing ? {} : { cookieConsent: {
        getCheckoutAnalyticsContext: async () => { lookups.push(true); if (throws) throw Error('analytics unavailable'); return context; }
      } }) }, gtag: (...args) => events.push(args) },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return Response.json({ ok: true, action: 'redirect', url: 'https://checkout.example.test/fixture' }); },
    createInlineToast: message => { throw Error('Billing unexpectedly failed: ' + message); }
  });
  vm.runInContext(clientFunction, ctx);
  return { ctx, calls, events, lookups, run: () => ctx.upgradePlan('monthly', { source: 'pricing-page' }) };
}

test('shared upgrade flow forwards consented campaign context once without a second checkout event', async () => {
  const context = analytics(), h = clientHarness({ context }); await h.run();
  assert.equal(h.lookups.length, 1); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], { url: '/api/upgrade-plan', body: {
    targetPlan: 'monthly', source: 'pricing-page', returnUrl: 'https://qa.jobhackai.io/pricing', analytics: context
  } });
  assert.equal(h.events.length, 0);
  assert.equal(h.ctx.window.location.href, 'https://checkout.example.test/fixture');
});
for (const [name, options] of [['denied', { context: null }], ['missing', { missing: true }], ['unavailable', { throws: true }]]) {
  test(name + ' analytics cannot block or add context to the shared upgrade request', async () => {
    const h = clientHarness(options); await h.run();
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.targetPlan, 'monthly');
    assert.equal('analytics' in h.calls[0].body, false); assert.equal(h.events.length, 0);
    assert.equal(h.ctx.window.location.href, 'https://checkout.example.test/fixture');
  });
}
test('canceled upgrade confirmation neither gathers analytics nor calls billing', async () => {
  const h = clientHarness({ confirmed: false }); await h.run();
  assert.equal(h.lookups.length, 0); assert.equal(h.calls.length, 0); assert.equal(h.events.length, 0);
});

// Execute the shipped route with real attribution SQL and plan/checkout
// helpers. Auth, established customer resolution and Stripe are fixture edges.
function routeHarness(t, { subscription = null, beforeSave = async () => {} } = {}) {
  const db = sqliteD1(); t.after(() => db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, auth_id TEXT);
    INSERT INTO users VALUES(42,'owner'),(43,'other');
    CREATE TABLE cookie_consents(id INTEGER PRIMARY KEY, user_id INTEGER, client_id TEXT, consent_json TEXT);
    INSERT INTO cookie_consents(user_id,consent_json) VALUES(42,'{"version":1,"analytics":true}');`);
  db.exec(migration);
  const env = { DB: db, ENVIRONMENT: 'qa', FIREBASE_PROJECT_ID: 'fixture', STRIPE_SECRET_KEY: 'sk_test_fixture',
    FRONTEND_URL: 'https://qa.jobhackai.io', STRIPE_PRICE_WEEKLY: 'price_weekly', STRIPE_PRICE_MONTHLY: 'price_monthly',
    STRIPE_PRICE_ESSENTIAL: 'price_essential', JOBHACKAI_KV: { get: async () => 'cus_owner', put: async () => {} } };
  const calls = [], saves = [];
  const session = { id: 'cs_test_upgrade', customer: 'cus_owner', status: 'open', url: 'https://checkout.example.test/fixture' };
  const fixedTime = Date.now();
  class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [fixedTime])); } static now() { return fixedTime; } }
  const ctx = vm.createContext({ console: quiet, Request, Response, URL, URLSearchParams, TextEncoder, Date: FixtureDate,
    crypto: { randomUUID: () => 'fixed-upgrade-attempt', subtle: webcrypto.subtle },
    accountOperationEnv, assertStripeKeyMatchesEnvironment, redactId, readSubscriptionPeriod,
    planToPrice, priceIdToPlan, planRank, pickBestSubscription, kvCusKey,
    buildUpgradeCheckoutSessionBody, selectSubscriptionsToCancel, ENTITLED_SUBSCRIPTION_STATUSES,
    getBearer: request => request.headers.get('Authorization')?.replace(/^Bearer /, ''),
    verifyFirebaseIdToken: async token => { assert.equal(token, 'valid'); return { uid: 'owner', payload: { email: 'owner@example.test' } }; },
    resolveStaleCustomerFromKV: async (_env, _uid, customerId) => ({ customerId }),
    cacheCustomerId: async () => {}, listSubscriptions: async () => subscription ? [subscription] : [],
    invalidateBillingCaches: async () => {}, updateUserPlan: async () => {},
    resetFeatureDailyUsage: async () => {}, resetUsageEvents: async () => {},
    assertNoCrossUserStripeIds: async () => ({ ok: true }),
    saveCheckoutAttribution: async (...args) => { saves.push(args); await beforeSave(); return saveCheckoutAttribution(...args); },
    stripe: async (_env, path, options) => {
      calls.push({ path, ...options });
      if (path === '/checkout/sessions') return Response.json(session);
      if (path === '/subscriptions/sub_owner') return Response.json({ ...subscription, status: 'active' });
      if (path === '/subscription_schedules' || path === '/subscription_schedules/sched_owner') return Response.json({ id: 'sched_owner' });
      throw Error('Unexpected Stripe operation: ' + path);
    }
  });
  vm.runInContext(routeSource.replace(/^import\s[\s\S]*?;\n/gm, '').replace('export async function onRequest', 'async function onRequest'), ctx);
  return { db, env, calls, saves, session,
    rows: async () => (await db.prepare('SELECT * FROM checkout_attributions ORDER BY checkout_session_id').all()).results,
    run: (body = { targetPlan: 'monthly', analytics: analytics() }, cookie = 'jha_client_id_qa=' + clientId) => ctx.onRequest({ env,
      request: new Request('https://qa.jobhackai.io/api/upgrade-plan', { method: 'POST', headers: {
        Authorization: 'Bearer valid', Origin: env.FRONTEND_URL, Cookie: cookie
      }, body: JSON.stringify({ source: 'pricing-page', returnUrl: env.FRONTEND_URL + '/pricing', ...body }) }) })
  };
}

for (const plan of ['weekly', 'monthly', 'essential']) {
  test(plan + ' fresh checkout saves consented context for the verified owner before returning its redirect', async t => {
    const h = routeHarness(t), context = analytics();
    const response = await h.run({ targetPlan: plan, analytics: context, uid: 'other', customerId: 'cus_other' });
    assert.equal(response.status, 200); assert.equal((await response.json()).action, 'redirect');
    const rows = await h.rows(); assert.equal(rows.length, 1); assert.equal(h.saves.length, 1);
    assert.equal(rows[0].user_id, 42); assert.equal(rows[0].stripe_customer_id, 'cus_owner');
    assert.equal(rows[0].checkout_session_id, h.session.id); assert.equal(rows[0].environment, 'qa');
    assert.equal(rows[0].ga_client_id, context.gaClientId); assert.equal(rows[0].ga_session_id, context.gaSessionId);
    assert.deepEqual(JSON.parse(rows[0].first_touch_json), { ...context.firstTouch });
    await h.run({ targetPlan: plan, analytics: { ...context, lastTouch: { ...context.lastTouch, campaign: 'replacement' } } });
    assert.deepEqual(await h.rows(), rows, 'a repeated session never overwrites its original context');
    assert.equal(new URLSearchParams(h.calls[0].body).get('line_items[0][price]'), 'price_' + plan);
  });
}
test('fresh checkout waits for the attribution attempt but never changes Stripe form or idempotency parameters', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  let started; const saving = new Promise(resolve => { started = resolve; });
  const h = routeHarness(t, { beforeSave: () => { started(); return gate; } });
  let returned = false;
  const request = h.run().then(response => { returned = true; return response; });
  await Promise.race([saving, request]);
  try { assert.equal(returned, false); assert.equal(h.saves.length, 1); } finally { release(); }
  assert.equal((await request).status, 200);
  const withAnalytics = h.calls[0];
  await h.run({ targetPlan: 'monthly' });
  assert.equal(h.calls[1].body, withAnalytics.body);
  assert.equal(h.calls[1].headers['Idempotency-Key'], withAnalytics.headers['Idempotency-Key']);
  assert.equal(new URLSearchParams(withAnalytics.body).has('analytics'), false);
});
test('missing or denied context, account consent, browser consent and foreign cookies keep fresh checkout unattributed', async t => {
  const h = routeHarness(t);
  for (const context of [undefined, { analyticsConsent: false }]) {
    assert.equal((await h.run({ targetPlan: 'monthly', analytics: context })).status, 200);
  }
  await h.db.prepare('UPDATE cookie_consents SET consent_json=? WHERE user_id=42').bind('{"version":1,"analytics":false}').run();
  assert.equal((await h.run()).status, 200);
  await h.db.prepare('UPDATE cookie_consents SET consent_json=? WHERE user_id=42').bind('{"version":1,"analytics":true}').run();
  await h.db.prepare('INSERT INTO cookie_consents(client_id,consent_json) VALUES(?,?)').bind(clientId, '{"version":1,"analytics":false}').run();
  assert.equal((await h.run()).status, 200);
  assert.equal((await h.run(undefined, 'jha_client_id=' + clientId)).status, 200);
  assert.equal((await h.rows()).length, 0);
});
test('failed attribution storage still returns the existing fresh-checkout redirect', async t => {
  const h = routeHarness(t); h.db.exec('DROP TABLE checkout_attributions;');
  const response = await h.run(); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, action: 'redirect', url: h.session.url });
  assert.equal(h.calls.length, 1); assert.equal(h.saves.length, 1);
});
for (const [name, plan, status, target, action] of [
  ['active upgrade', 'weekly', 'active', 'monthly', 'updated'],
  ['scheduled downgrade', 'monthly', 'active', 'weekly', 'scheduled'],
  ['legacy trial conversion', 'trial', 'trialing', 'essential', 'updated']
]) {
  test(name + ' neither creates a checkout nor rewrites existing attribution', async t => {
    const subscription = { id: 'sub_owner', customer: 'cus_owner', status, metadata: { plan, original_plan: plan },
      current_period_start: 1788000000, current_period_end: 1790600000,
      items: { data: [{ id: 'si_owner', price: { id: 'price_' + (plan === 'trial' ? 'essential' : plan) } }] } };
    const h = routeHarness(t, { subscription });
    await saveCheckoutAttribution(h.env, { request: new Request('https://qa.jobhackai.io/', { headers: { Cookie: 'jha_client_id_qa=' + clientId } }),
      session: h.session, uid: 'owner', customerId: 'cus_owner', analytics: analytics() });
    const original = await h.rows(); assert.equal(original.length, 1);
    const response = await h.run({ targetPlan: target, analytics: analytics() });
    assert.equal(response.status, 200); assert.equal((await response.json()).action, action);
    assert.equal(h.saves.length, 0); assert.ok(h.calls.every(call => call.path !== '/checkout/sessions'));
    assert.deepEqual(await h.rows(), original);
  });
}
