// dev0 voice subscriptions (weekly / monthly) and the supported legacy tiers
// through the hardened webhook, plus the plan mappers and write paths they
// depend on. Proves the merged code treats weekly/monthly exactly like the
// legacy paid tiers (periods, has_ever_paid, dunning, cancellation,
// ownership) and that subscription writes never touch voice credits.
// Run: node app/functions/_lib/__tests__/stripe-webhook-voice-plans.test.mjs
import assert from 'node:assert';
import { onRequest } from '../../api/stripe-webhook.js';
import { buildUserPlanUpdateStatement, updateUserPlan, PAID_SUBSCRIPTION_PLANS } from '../db.js';
import { planToPrice, priceIdToPlan, pickBestSubscription, planRank } from '../billing-utils.js';
import {
  createFakeD1, createFakeKV, makeEnv, makeEvent, makeSubscription,
  postWebhook, stubStripeFetch
} from './billing-test-helper.mjs';

const START = 1755000000, END = 1755604800; // one week
const startIso = new Date(START * 1000).toISOString();
const endIso = new Date(END * 1000).toISOString();

const devEnv = (over = {}) => makeEnv({
  ENVIRONMENT: 'dev', STRIPE_SECRET_KEY: 'sk_test_fake_suite_key', FRONTEND_URL: 'https://dev.jobhackai.io',
  GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 's', ...over
});
const user = (over = {}) => ({
  id: 1, auth_id: 'uid_V', email: 'v@example.com', plan: 'free',
  stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null,
  trial_ends_at: null, current_period_start: null, current_period_end: null,
  cancel_at: null, scheduled_plan: null, scheduled_at: null,
  has_ever_paid: 0, plan_updated_at: '2020-01-01T00:00:00.000Z',
  voice_sessions_remaining: 0, free_session_used: 0, pack_expires_at: null, ...over
});
const cusStub = (uid = 'uid_V', id = 'cus_V') => ({ match: `/v1/customers/${id}`, reply: { json: { id, email: 'v@example.com', metadata: uid ? { firebaseUid: uid } : {} } } });
const subEvent = (type, sub) => makeEvent(type, sub, { livemode: false });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); process.exitCode = 1; }
}

console.log('stripe-webhook voice-plans suite\n');

await test('plan mappers: weekly/monthly/pack round-trip through env price ids; legacy tiers intact', () => {
  const env = devEnv();
  assert.strictEqual(planToPrice(env, 'weekly'), 'price_weekly_test');
  assert.strictEqual(planToPrice(env, 'monthly'), 'price_monthly_test');
  assert.strictEqual(planToPrice(env, 'pack'), 'price_pack_test');
  assert.strictEqual(priceIdToPlan(env, 'price_weekly_test'), 'weekly');
  assert.strictEqual(priceIdToPlan(env, 'price_monthly_test'), 'monthly');
  assert.strictEqual(priceIdToPlan(env, 'price_pack_test'), 'pack');
  assert.strictEqual(priceIdToPlan(env, 'price_premium_test'), 'premium');
  assert.strictEqual(priceIdToPlan(env, 'price_unknown'), null);
  assert.ok(planRank('monthly') > planRank('weekly'), 'dev0 ranking: monthly above weekly');
  assert.ok(planRank('premium') > planRank('monthly'));
  for (const p of ['weekly', 'monthly', 'essential', 'pro', 'premium']) assert.ok(PAID_SUBSCRIPTION_PLANS.has(p), `${p} is a paid subscription plan`);
  assert.ok(!PAID_SUBSCRIPTION_PLANS.has('pack'), 'the one-time pack is not a subscription plan');
});

await test('pickBestSubscription: same status → higher-ranked voice plan wins; status still comes first', () => {
  const env = devEnv();
  const weekly = makeSubscription({ id: 'sub_w', priceId: 'price_weekly_test', status: 'active', extra: { created: 100 } });
  const monthly = makeSubscription({ id: 'sub_m', priceId: 'price_monthly_test', status: 'active', extra: { created: 50 } });
  assert.strictEqual(pickBestSubscription([weekly, monthly], env).bestSub.id, 'sub_m');
  const monthlyUnpaid = makeSubscription({ id: 'sub_mu', priceId: 'price_monthly_test', status: 'unpaid' });
  assert.strictEqual(pickBestSubscription([weekly, monthlyUnpaid], env).bestSub.id, 'sub_w', 'active weekly beats unpaid monthly (status before plan)');
});

await test('has_ever_paid marks for weekly/monthly on BOTH write paths; never auto-marks for the pack label', async () => {
  for (const plan of ['weekly', 'monthly']) {
    const db = createFakeD1({ users: [user()] });
    await db.batch([buildUserPlanUpdateStatement(db, 'uid_V', { plan, planEventTimestamp: '2026-09-01T00:00:00.000Z' })]);
    assert.strictEqual(db.usersByAuthId('uid_V').has_ever_paid, 1, `${plan}: batch path marks has_ever_paid`);
    const db2 = createFakeD1({ users: [user()] });
    await updateUserPlan({ DB: db2 }, 'uid_V', { plan });
    assert.strictEqual(db2.usersByAuthId('uid_V').has_ever_paid, 1, `${plan}: direct path marks has_ever_paid`);
  }
  const db3 = createFakeD1({ users: [user()] });
  await db3.batch([buildUserPlanUpdateStatement(db3, 'uid_V', { plan: 'pack' })]);
  assert.strictEqual(db3.usersByAuthId('uid_V').has_ever_paid, 0, 'pack is granted (and marked) by voice-entitlements, not by a plan write');
});

await test('customer.subscription.created weekly → plan weekly, item-shape periods, has_ever_paid, ledger processed', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub()]);
  const sub = makeSubscription({ id: 'sub_w1', customer: 'cus_V', priceId: 'price_weekly_test', metadata: { firebaseUid: 'uid_V' }, itemPeriodStart: START, itemPeriodEnd: END });
  const event = subEvent('customer.subscription.created', sub);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_V');
  assert.strictEqual(row.plan, 'weekly');
  assert.strictEqual(row.subscription_status, 'active');
  assert.strictEqual(row.stripe_subscription_id, 'sub_w1');
  assert.strictEqual(row.stripe_customer_id, 'cus_V');
  assert.strictEqual(row.current_period_start, startIso);
  assert.strictEqual(row.current_period_end, endIso);
  assert.strictEqual(row.has_ever_paid, 1);
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
});

await test('checkout.session.completed monthly → plan monthly with a $34 GA4 purchase; legacy premium still maps', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const session = { id: 'cs_m1', mode: 'subscription', status: 'complete', payment_status: 'paid', customer: 'cus_V', metadata: { plan: 'monthly', firebaseUid: 'uid_V' }, customer_details: { email: 'v@example.com' } };
  const stub = stubStripeFetch([
    { match: '/v1/checkout/sessions/cs_m1', reply: { json: { ...session, line_items: { data: [{ price: { id: 'price_monthly_test', unit_amount: 3400 } }] }, subscription: 'sub_m1', amount_total: 3400, currency: 'usd' } } },
    { match: '/v1/subscriptions/sub_m1', reply: { json: makeSubscription({ id: 'sub_m1', customer: 'cus_V', priceId: 'price_monthly_test', itemPeriodStart: START, itemPeriodEnd: END }) } },
    cusStub()
  ]);
  const res = await postWebhook(onRequest, env, makeEvent('checkout.session.completed', session, { livemode: false }));
  const purchases = stub.calls.filter((c) => c.url.includes('google-analytics') && String(c.init?.body || '').includes('"purchase"'));
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_V').plan, 'monthly');
  assert.strictEqual(purchases.length, 1);
  assert.ok(String(purchases[0].init.body).includes('"value":34'), 'purchase value from amount_total');
  assert.ok(String(purchases[0].init.body).includes('"plan":"monthly"'));

  const db2 = createFakeD1({ users: [user()] });
  const env2 = devEnv({ DB: db2, JOBHACKAI_KV: createFakeKV() });
  const stub2 = stubStripeFetch([cusStub()]);
  const prem = makeSubscription({ id: 'sub_p1', customer: 'cus_V', priceId: 'price_premium_test', metadata: { firebaseUid: 'uid_V' }, itemPeriodStart: START, itemPeriodEnd: END });
  assert.strictEqual((await postWebhook(onRequest, env2, subEvent('customer.subscription.created', prem))).status, 200);
  stub2.restore();
  assert.strictEqual(db2.usersByAuthId('uid_V').plan, 'premium');
});

await test('a pack holder who subscribes monthly keeps every credit; the subscription write touches no voice column', async () => {
  const db = createFakeD1({ users: [user({ plan: 'pack', voice_sessions_remaining: 4, pack_expires_at: '2026-12-01T00:00:00.000Z', free_session_used: 1, has_ever_paid: 1 })] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub()]);
  const sub = makeSubscription({ id: 'sub_m2', customer: 'cus_V', priceId: 'price_monthly_test', metadata: { firebaseUid: 'uid_V' }, itemPeriodStart: START, itemPeriodEnd: END });
  const res = await postWebhook(onRequest, env, subEvent('customer.subscription.created', sub));
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_V');
  assert.strictEqual(row.plan, 'monthly');
  assert.strictEqual(row.voice_sessions_remaining, 4);
  assert.strictEqual(row.pack_expires_at, '2026-12-01T00:00:00.000Z');
  assert.strictEqual(row.free_session_used, 1);
  const batch = db.__state.batches[0];
  assert.ok(!batch.some((sql) => /voice_sessions_remaining|pack_expires_at|free_session_used/.test(sql)), 'no voice column in the subscription batch');
});

await test('customer.subscription.deleted for a monthly subscriber: plan free, periods cleared, credits preserved', async () => {
  const db = createFakeD1({ users: [user({ plan: 'monthly', subscription_status: 'active', stripe_customer_id: 'cus_V', stripe_subscription_id: 'sub_m3', current_period_start: startIso, current_period_end: endIso, has_ever_paid: 1, voice_sessions_remaining: 2, pack_expires_at: '2026-12-01T00:00:00.000Z' })] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const deleted = makeSubscription({ id: 'sub_m3', customer: 'cus_V', priceId: 'price_monthly_test', status: 'canceled', metadata: { firebaseUid: 'uid_V' }, itemPeriodStart: START, itemPeriodEnd: END });
  const stub = stubStripeFetch([
    cusStub(),
    { match: '/v1/subscriptions?customer=cus_V', reply: { json: { data: [deleted] } } }
  ]);
  const res = await postWebhook(onRequest, env, subEvent('customer.subscription.deleted', deleted));
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_V');
  assert.strictEqual(row.plan, 'free');
  assert.strictEqual(row.subscription_status, 'canceled');
  assert.strictEqual(row.stripe_subscription_id, null);
  assert.strictEqual(row.current_period_start, null);
  assert.strictEqual(row.current_period_end, null);
  assert.strictEqual(row.has_ever_paid, 1, 'has_ever_paid preserved');
  assert.strictEqual(row.voice_sessions_remaining, 2, 'pack credits survive a subscription deletion');
  assert.strictEqual(row.pack_expires_at, '2026-12-01T00:00:00.000Z');
});

await test('dunning parity: a monthly subscription in unpaid keeps plan=monthly with status unpaid', async () => {
  const db = createFakeD1({ users: [user({ plan: 'monthly', subscription_status: 'active', stripe_customer_id: 'cus_V', stripe_subscription_id: 'sub_m4', has_ever_paid: 1 })] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub()]);
  const sub = makeSubscription({ id: 'sub_m4', customer: 'cus_V', priceId: 'price_monthly_test', status: 'unpaid', metadata: { firebaseUid: 'uid_V' }, itemPeriodStart: START, itemPeriodEnd: END });
  const res = await postWebhook(onRequest, env, subEvent('customer.subscription.updated', sub));
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_V');
  assert.strictEqual(row.plan, 'monthly', 'dunning keeps the plan (webhook policy)');
  assert.strictEqual(row.subscription_status, 'unpaid');
});

await test('scheduled cancellation on a weekly subscription writes cancel_at', async () => {
  const db = createFakeD1({ users: [user({ plan: 'weekly', subscription_status: 'active', stripe_customer_id: 'cus_V', stripe_subscription_id: 'sub_w5', has_ever_paid: 1 })] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub()]);
  const cancelAt = END + 3600;
  const sub = makeSubscription({ id: 'sub_w5', customer: 'cus_V', priceId: 'price_weekly_test', metadata: { firebaseUid: 'uid_V' }, itemPeriodStart: START, itemPeriodEnd: END, extra: { cancel_at_period_end: true, cancel_at: cancelAt } });
  const res = await postWebhook(onRequest, env, subEvent('customer.subscription.updated', sub));
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_V');
  assert.strictEqual(row.plan, 'weekly');
  assert.strictEqual(row.cancel_at, new Date(cancelAt * 1000).toISOString());
});

await test('ownership conflict on a weekly subscription: 500, ledger failed, no writes to either user', async () => {
  const db = createFakeD1({ users: [user(), user({ id: 2, auth_id: 'uid_OTHER', email: 'o@example.com' })] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub('uid_OTHER')]);
  const sub = makeSubscription({ id: 'sub_w6', customer: 'cus_V', priceId: 'price_weekly_test', metadata: { firebaseUid: 'uid_V' }, itemPeriodStart: START, itemPeriodEnd: END });
  const event = subEvent('customer.subscription.created', sub);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 500);
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'owner_conflict');
  assert.strictEqual(db.usersByAuthId('uid_V').plan, 'free');
  assert.strictEqual(db.usersByAuthId('uid_OTHER').plan, 'free');
  assert.strictEqual(db.__state.batches.length, 0);
});

await test('wrong-mode weekly event in dev (livemode=true): zero D1 and KV writes', async () => {
  const db = createFakeD1({ users: [user()] });
  const kv = createFakeKV();
  const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
  const sub = makeSubscription({ id: 'sub_w7', customer: 'cus_V', priceId: 'price_weekly_test', metadata: { firebaseUid: 'uid_V' }, itemPeriodStart: START, itemPeriodEnd: END });
  const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.created', sub, { livemode: true }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), '[ignored-wrong-mode]');
  assert.strictEqual(db.__state.writes, 0);
  assert.strictEqual(kv.writeCount, 0);
});

await test('subscription write whose recipient vanished before the batch: 503 recipient_row_missing, retry writes once', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([cusStub()]);
  const sub = makeSubscription({ id: 'sub_w9', customer: 'cus_V', priceId: 'price_weekly_test', metadata: { firebaseUid: 'uid_V' }, itemPeriodStart: START, itemPeriodEnd: END });
  const event = subEvent('customer.subscription.created', sub);
  const realBatch = db.batch.bind(db);
  db.batch = async (stmts) => { db.__state.tables.users = db.__state.tables.users.filter((u) => u.auth_id !== 'uid_V'); return realBatch(stmts); };
  const res1 = await postWebhook(onRequest, env, event);
  db.batch = realBatch;
  assert.strictEqual(res1.status, 503);
  assert.strictEqual(await res1.text(), 'event failed: recipient_row_missing');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
  const res2 = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_V').plan, 'weekly', 'retry re-created the row and applied the plan');
  assert.strictEqual(db.ledgerRow(event.id)?.attempt_count, 2);
});

await test('subscription.deleted / invoice.payment_failed for a uid with no users row here are recorded no-ops (no row created)', async () => {
  // e.g. a customer whose account lives only in the other environment
  const db = createFakeD1({ users: [] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const deleted = makeSubscription({ id: 'sub_gone', customer: 'cus_V', priceId: 'price_monthly_test', status: 'canceled', metadata: { firebaseUid: 'uid_V' }, itemPeriodStart: START, itemPeriodEnd: END });
  let stub = stubStripeFetch([cusStub()]);
  const ev1 = subEvent('customer.subscription.deleted', deleted);
  const res1 = await postWebhook(onRequest, env, ev1);
  stub.restore();
  assert.strictEqual(res1.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_V'), null, 'no row created by a deletion');
  assert.strictEqual(db.ledgerRow(ev1.id)?.status, 'processed');

  const invoice = { id: 'in_1', customer: 'cus_V', subscription: 'sub_pd' };
  stub = stubStripeFetch([cusStub(), { match: '/v1/subscriptions/sub_pd', reply: { json: makeSubscription({ id: 'sub_pd', customer: 'cus_V', status: 'past_due', priceId: 'price_monthly_test', metadata: { firebaseUid: 'uid_V' } }) } }]);
  const ev2 = subEvent('invoice.payment_failed', invoice);
  const res2 = await postWebhook(onRequest, env, ev2);
  stub.restore();
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_V'), null);
  assert.strictEqual(db.ledgerRow(ev2.id)?.status, 'processed');
  assert.strictEqual(db.__state.batches.every((b) => b.every((sql) => !sql.startsWith('UPDATE users'))), true, 'no users writes at all');
});

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
