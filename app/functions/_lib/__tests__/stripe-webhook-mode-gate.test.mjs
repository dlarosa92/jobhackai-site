// End-to-end webhook mode-gate matrix against real signed payloads:
// wrong-mode events produce ZERO D1 and ZERO KV writes; unknown environment
// and mis-matched keys fail closed with 503; a missing event ledger fails
// closed with 503 and zero processing (no KV fallback).
import assert from 'node:assert';
import { onRequest } from '../../api/stripe-webhook.js';
import {
  createFakeD1, createFakeKV, makeEnv, makeEvent, makeSubscription,
  postWebhook, signStripeEvent, TEST_WEBHOOK_SECRET
} from './billing-test-helper.mjs';

const START = 1755000000, END = 1757678400;

function seedUser(extra = {}) {
  return {
    id: 1, auth_id: 'uid_A', email: 'a@example.com', plan: 'free',
    stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null,
    trial_ends_at: null, current_period_start: null, current_period_end: null,
    cancel_at: null, scheduled_plan: null, scheduled_at: null,
    has_ever_paid: 0, plan_updated_at: '2020-01-01T00:00:00.000Z', ...extra
  };
}

function liveSubCreatedEvent({ livemode = true } = {}) {
  const sub = makeSubscription({
    id: 'sub_gate01', customer: 'cus_gate01', status: 'active',
    priceId: 'price_essential_test', metadata: { firebaseUid: 'uid_A' },
    itemPeriodStart: START, itemPeriodEnd: END
  });
  return makeEvent('customer.subscription.created', sub, { livemode });
}

const customerStub = { match: '/v1/customers/cus_gate01', reply: { json: { id: 'cus_gate01', email: 'a@example.com', metadata: { firebaseUid: 'uid_A' } } } };

import { stubStripeFetch } from './billing-test-helper.mjs';

// 1. Valid LIVE event + prod env (live key) → processed, D1 updated, ledger processed.
{
  const db = createFakeD1({ users: [seedUser()] });
  const kv = createFakeKV();
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv });
  const stub = stubStripeFetch([customerStub]);
  const event = liveSubCreatedEvent();
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_A');
  assert.strictEqual(row.plan, 'essential');
  assert.strictEqual(row.stripe_subscription_id, 'sub_gate01');
  assert.strictEqual(row.current_period_start, new Date(START * 1000).toISOString());
  assert.strictEqual(row.current_period_end, new Date(END * 1000).toISOString());
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
  assert.ok(db.ledgerRow(event.id)?.processed_at, 'processed_at set');
  assert.strictEqual(db.ledgerRow(event.id)?.livemode, 1);
}

// 2. Valid TEST event + prod env → 200 acknowledged, ZERO D1 writes, ZERO KV
//    writes, and NO ledger row (wrong-mode events never populate storage).
{
  const db = createFakeD1({ users: [seedUser()] });
  const kv = createFakeKV();
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv });
  const event = liveSubCreatedEvent({ livemode: false });
  const res = await postWebhook(onRequest, env, event);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), '[ignored-wrong-mode]');
  assert.strictEqual(db.__state.writes, 0, 'zero D1 writes for wrong-mode event');
  assert.strictEqual(kv.writeCount, 0, 'zero KV writes for wrong-mode event');
  assert.strictEqual(db.ledgerRow(event.id), null, 'no ledger row for wrong-mode event');
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'free');
}

// 3. Valid LIVE event + qa env (test key) → ignored with zero writes.
{
  const db = createFakeD1({ users: [seedUser()] });
  const kv = createFakeKV();
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv, ENVIRONMENT: 'qa', STRIPE_SECRET_KEY: 'sk_test_x' });
  const res = await postWebhook(onRequest, env, liveSubCreatedEvent({ livemode: true }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), '[ignored-wrong-mode]');
  assert.strictEqual(db.__state.writes, 0);
  assert.strictEqual(kv.writeCount, 0);
}

// 4. Valid TEST event + qa env → processed normally.
{
  const db = createFakeD1({ users: [seedUser()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV(), ENVIRONMENT: 'qa', STRIPE_SECRET_KEY: 'sk_test_x' });
  const stub = stubStripeFetch([customerStub]);
  const event = liveSubCreatedEvent({ livemode: false });
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'essential');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
  assert.strictEqual(db.ledgerRow(event.id)?.livemode, 0);
}

// 5. Invalid signature → 401, zero writes anywhere.
{
  const db = createFakeD1({ users: [seedUser()] });
  const kv = createFakeKV();
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv });
  const res = await postWebhook(onRequest, env, liveSubCreatedEvent(), { secret: 'whsec_wrong_secret' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(db.__state.writes, 0);
  assert.strictEqual(kv.writeCount, 0);
}

// 6. Unknown ENVIRONMENT + LIVE key → 503 config error, zero writes
//    (fully fail-closed: the key never infers the environment).
{
  const db = createFakeD1({ users: [seedUser()] });
  const kv = createFakeKV();
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv, ENVIRONMENT: 'staging' });
  const res = await postWebhook(onRequest, env, liveSubCreatedEvent());
  assert.strictEqual(res.status, 503);
  assert.strictEqual(db.__state.writes, 0);
  assert.strictEqual(kv.writeCount, 0);
}

// 7. Missing ENVIRONMENT entirely → 503, zero writes.
{
  const db = createFakeD1({ users: [seedUser()] });
  const kv = createFakeKV();
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv });
  delete env.ENVIRONMENT;
  const res = await postWebhook(onRequest, env, liveSubCreatedEvent());
  assert.strictEqual(res.status, 503);
  assert.strictEqual(db.__state.writes, 0);
  assert.strictEqual(kv.writeCount, 0);
}

// 8. prod env + TEST key → 503 config error (key/env mismatch), zero writes.
{
  const db = createFakeD1({ users: [seedUser()] });
  const kv = createFakeKV();
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv, STRIPE_SECRET_KEY: 'sk_test_x' });
  const res = await postWebhook(onRequest, env, liveSubCreatedEvent({ livemode: false }));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(db.__state.writes, 0);
  assert.strictEqual(kv.writeCount, 0);
}

// 9. Ledger table missing (rollback-only scenario) → 503 with zero
//    processing, zero D1 writes, zero KV writes. NO KV fallback.
{
  const db = createFakeD1({ users: [seedUser()], ledgerTableMissing: true });
  const kv = createFakeKV();
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv });
  const res = await postWebhook(onRequest, env, liveSubCreatedEvent());
  assert.strictEqual(res.status, 503);
  assert.strictEqual(await res.text(), 'event ledger unavailable');
  assert.strictEqual(db.__state.writes, 0, 'no D1 writes when ledger is missing');
  assert.strictEqual(kv.__puts.length, 0, 'no KV fallback marker when ledger is missing');
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'free');
}

// 10. No DB binding at all → 503 (fail closed), zero KV writes.
{
  const kv = createFakeKV();
  const env = makeEnv({ JOBHACKAI_KV: kv });
  const res = await postWebhook(onRequest, env, liveSubCreatedEvent());
  assert.strictEqual(res.status, 503);
  assert.strictEqual(kv.__puts.length, 0);
}

// 11. Malformed event (no id) → 400, zero writes.
{
  const db = createFakeD1({ users: [seedUser()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const { raw, header } = signStripeEvent(TEST_WEBHOOK_SECRET, { type: 'x', livemode: true });
  const request = new Request('https://app.jobhackai.io/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': header }, body: raw
  });
  const res = await onRequest({ request, env, waitUntil() {} });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(db.__state.writes, 0);
}

// 12. Signature timestamp outside tolerance → 401.
{
  const db = createFakeD1({ users: [seedUser()] });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stale = Math.floor(Date.now() / 1000) - 3600;
  const res = await postWebhook(onRequest, env, liveSubCreatedEvent(), { timestamp: stale });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(db.__state.writes, 0);
}

// 13. (PR #851 F1) A LEGACY `evt:` marker — written by the old webhook
//     BEFORE processing — must NOT be trusted: the event still processes
//     fully through the ledger. Only the new `evtl:` marker short-circuits.
{
  const db = createFakeD1({ users: [seedUser()] });
  const kv = createFakeKV({ 'evt:evt_legacy_1': '1' }); // old-code marker, no ledger row
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv });
  const stub = stubStripeFetch([customerStub]);
  const sub = makeSubscription({
    id: 'sub_gate01', customer: 'cus_gate01', status: 'active',
    priceId: 'price_essential_test', metadata: { firebaseUid: 'uid_A' },
    itemPeriodStart: START, itemPeriodEnd: END
  });
  const event = makeEvent('customer.subscription.created', sub, { id: 'evt_legacy_1' });
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'essential', 'legacy marker must not suppress processing');
  assert.strictEqual(db.ledgerRow('evt_legacy_1')?.status, 'processed', 'ledger row created despite legacy marker');
  assert.ok(kv.__puts.includes('evtl:prod:evt_legacy_1'), 'post-commit marker uses the versioned, environment-scoped key');
}

// 14. (PR #851 F1) The versioned `evtl:` marker (only ever written after a
//     durable commit) short-circuits with zero writes. (dev0 integration: the
//     marker is scoped by ENVIRONMENT — see test 15.)
{
  const db = createFakeD1({ users: [seedUser()] });
  const kv = createFakeKV({ 'evtl:prod:evt_new_1': '1' });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv });
  const sub = makeSubscription({ id: 'sub_gate01', customer: 'cus_gate01', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START, itemPeriodEnd: END });
  const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.created', sub, { id: 'evt_new_1' }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.__state.writes, 0, 'evtl: fast-path performs zero D1 writes');
  assert.strictEqual(kv.writeCount, 0, 'evtl: fast-path performs zero KV writes');
}

// 15. (dev0 integration) dev and QA share one Stripe test-mode account (every
//     test event is delivered to BOTH webhooks) and one KV namespace. A
//     marker written by the other environment — or an unscoped legacy
//     `evtl:` marker — must never suppress this environment's delivery: the
//     event still processes fully through this environment's own ledger.
{
  const db = createFakeD1({ users: [seedUser()] });
  const kv = createFakeKV({ 'evtl:qa:evt_shared_1': '1', 'evtl:evt_shared_1': '1', 'processing:qa:evt_shared_1': '1' });
  const env = makeEnv({ DB: db, JOBHACKAI_KV: kv, ENVIRONMENT: 'dev', STRIPE_SECRET_KEY: 'sk_test_x' });
  const stub = stubStripeFetch([customerStub]);
  const sub = makeSubscription({ id: 'sub_gate01', customer: 'cus_gate01', metadata: { firebaseUid: 'uid_A' }, itemPeriodStart: START, itemPeriodEnd: END });
  const res = await postWebhook(onRequest, env, makeEvent('customer.subscription.created', sub, { id: 'evt_shared_1', livemode: false }));
  stub.restore();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_A').plan, 'essential', 'another environment\'s marker must not suppress processing here');
  assert.strictEqual(db.ledgerRow('evt_shared_1')?.status, 'processed');
  assert.ok(kv.__puts.includes('evtl:dev:evt_shared_1'), 'this environment writes its own scoped marker');
  assert.ok(kv.__map.has('evtl:qa:evt_shared_1'), 'the other environment\'s marker is left alone');
}

console.log('stripe-webhook-mode-gate.test.mjs: all assertions passed');
