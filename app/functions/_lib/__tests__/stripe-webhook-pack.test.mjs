// Interview Pack (one-time payment) through the hardened Stripe webhook —
// the dev0 voice work merged with the billing-integrity hotfix.
//
// Guards (bare Node, node:assert; run with
//   node app/functions/_lib/__tests__/stripe-webhook-pack.test.mjs):
//   - a pack purchase NEVER enters the subscription plan-mapping path (the
//     pre-#834 regression wrote plan='essential', i.e. unlimited voice, for a
//     one-time charge)
//   - credits, the legacy stripe_event_log row (voice migration 020) and the
//     ledger processed-mark (migration 022) commit in ONE atomic batch, so a
//     replay, a concurrent delivery, or a failed write can never double-credit
//     nor consume the event without granting
//   - events the pre-ledger webhook already granted (row in stripe_event_log,
//     no ledger row) are recorded as processed and never re-granted
//   - wrong-mode pack events write nothing at all
//
// Changed expectations vs. the dev0 suite this file replaces: the hardened
// webhook answers `event failed: <reason>` (500 critical / 503 transient) with
// a `failed` ledger row instead of a bare text body, needs ENVIRONMENT=dev +
// a test-mode key + livemode=false events (mode gate), and a failed session
// expansion (non-2xx) is a retryable 503 rather than an immediate grant from
// the signed payload — the grant then happens on Stripe's retry, exactly once.
import assert from 'node:assert';
import { onRequest } from '../../api/stripe-webhook.js';
import { PACK_SESSION_COUNT, PACK_EXPIRY_DAYS } from '../voice-entitlements.js';
import {
  createFakeD1, createFakeKV, makeEnv, makeEvent, makeSubscription,
  postWebhook, stubStripeFetch
} from './billing-test-helper.mjs';

const devEnv = (over = {}) => makeEnv({
  ENVIRONMENT: 'dev',
  STRIPE_SECRET_KEY: 'sk_test_fake_suite_key',
  FRONTEND_URL: 'https://dev.jobhackai.io',
  GA4_MEASUREMENT_ID: 'G-TEST',
  GA4_API_SECRET: 's',
  ...over
});

const user = (over = {}) => ({
  id: 1, auth_id: 'uid_pack', email: 'p@example.com', plan: 'free',
  stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null,
  trial_ends_at: null, current_period_start: null, current_period_end: null,
  cancel_at: null, scheduled_plan: null, scheduled_at: null,
  has_ever_paid: 0, plan_updated_at: '2020-01-01T00:00:00.000Z',
  voice_sessions_remaining: 0, free_session_used: 0, pack_expires_at: null, ...over
});

const packSession = (over = {}) => ({
  id: 'cs_pack_1', mode: 'payment', status: 'complete', payment_status: 'paid', customer: 'cus_pack_1',
  metadata: { plan: 'pack', firebaseUid: 'uid_pack' },
  customer_details: { email: 'p@example.com' }, ...over
});
const packEvent = (session = packSession(), opts = {}) =>
  makeEvent('checkout.session.completed', session, { livemode: false, ...opts });
const sessionStub = (session, extra = {}) => ({
  match: `/v1/checkout/sessions/${session.id}`,
  reply: { json: { ...session, line_items: { data: [{ price: { id: 'price_pack_test', unit_amount: 3900 } }] }, amount_total: 3900, currency: 'usd', subscription: null, ...extra } }
});
const customerStub = (uid = 'uid_pack', id = 'cus_pack_1') => ({
  match: `/v1/customers/${id}`,
  reply: { json: { id, email: 'p@example.com', metadata: uid ? { firebaseUid: uid } : {} } }
});
const ga4Purchases = (stub) => stub.calls.filter((c) => c.url.includes('google-analytics') && String(c.init?.body || '').includes('"purchase"'));

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); process.exitCode = 1; }
}

console.log('stripe-webhook pack suite (hardened webhook)\n');

await test('pack purchase: credits + legacy log + ledger mark in one batch; never the subscription path', async () => {
  const db = createFakeD1({ users: [user()] });
  const kv = createFakeKV();
  const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
  const session = packSession();
  const stub = stubStripeFetch([sessionStub(session), customerStub()]);
  const event = packEvent(session);
  const res = await postWebhook(onRequest, env, event);
  const purchases = ga4Purchases(stub);
  stub.restore();

  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_pack');
  assert.strictEqual(row.voice_sessions_remaining, PACK_SESSION_COUNT, 'exactly one pack of credits');
  assert.strictEqual(row.plan, 'pack', 'plan set by the grant, not by plan mapping');
  assert.strictEqual(row.has_ever_paid, 1);
  assert.strictEqual(row.stripe_subscription_id, null, 'no subscription fields written for a one-time charge');
  assert.strictEqual(row.stripe_customer_id, null, 'pack grant does not stamp billing ids (checkout caches the customer id)');
  const expiresMs = new Date(row.pack_expires_at).getTime();
  assert.ok(Math.abs(expiresMs - (Date.now() + PACK_EXPIRY_DAYS * 86400000)) < 60000, 'expiry ~90 days out');
  assert.ok(db.eventLogRow(event.id), 'legacy stripe_event_log row written (history preserved)');
  assert.strictEqual(db.eventLogRow(session.id)?.type, 'pack_fulfilment', 'per-session fulfilment marker written in the same batch');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');

  assert.strictEqual(db.__state.batches.length, 1, 'one atomic batch');
  const batch = db.__state.batches[0];
  assert.strictEqual(batch.filter((sql) => sql.startsWith('INSERT INTO stripe_event_log')).length, 2, 'event record + session marker ride the batch');
  assert.ok(batch.some((sql) => sql.includes('voice_sessions_remaining = voice_sessions_remaining + ?')), 'credit grant rides the batch');
  assert.ok(/^UPDATE stripe_event_ledger\s+SET status = CASE WHEN .* THEN 'processed'/s.test(batch[batch.length - 1].replace(/\s+/g, ' ')), 'recipient-guarded ledger mark is the final statement of the same batch');
  assert.ok(!batch.some((sql) => /UPDATE users SET plan = \?/.test(sql)), 'no subscription-path plan write');

  assert.strictEqual(purchases.length, 1, 'exactly one GA4 purchase, post-commit');
  assert.ok(String(purchases[0].init.body).includes('"plan":"pack"'));
  assert.ok(kv.__puts.includes(`evtl:dev:${event.id}`), 'environment-scoped fast-path marker written after commit');
  assert.ok(kv.__deletes.includes('planByUid:uid_pack'), 'billing caches invalidated post-commit');
});

await test('replay of a granted event: zero writes, credits unchanged — with and without KV', async () => {
  const db = createFakeD1({ users: [user()] });
  const kv = createFakeKV();
  const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
  const session = packSession();
  const stub = stubStripeFetch([sessionStub(session), customerStub()]);
  const event = packEvent(session);
  assert.strictEqual((await postWebhook(onRequest, env, event)).status, 200);
  const writes = db.__state.writes;
  const batches = db.__state.batches.length;

  assert.strictEqual((await postWebhook(onRequest, env, event)).status, 200, 'KV fast-path replay');
  assert.strictEqual(db.__state.writes, writes, 'replay performs zero D1 writes');
  kv.__map.clear();
  assert.strictEqual((await postWebhook(onRequest, env, event)).status, 200, 'ledger replay after KV loss');
  stub.restore();
  assert.strictEqual(db.__state.writes, writes, 'ledger alone blocks the re-grant');
  assert.strictEqual(db.__state.batches.length, batches);
  assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, PACK_SESSION_COUNT, 'never double-credited');
  assert.strictEqual(db.ledgerRow(event.id)?.attempt_count, 1, 'processed events are never re-claimed');
});

await test('concurrent delivery: a fresh in-flight claim (or lock) yields 503 with no grant', async () => {
  const session = packSession();
  const event = packEvent(session);
  // Another instance holds a fresh ledger claim.
  {
    const db = createFakeD1({ users: [user()], stripe_event_ledger: [{ event_id: event.id, event_type: event.type, livemode: 0, status: 'processing', attempt_count: 1, received_at: new Date().toISOString(), claimed_at: new Date().toISOString(), processed_at: null, last_error: null }] });
    const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
    const stub = stubStripeFetch([sessionStub(session), customerStub()]);
    const res = await postWebhook(onRequest, env, event);
    stub.restore();
    assert.strictEqual(res.status, 503);
    assert.strictEqual(db.__state.batches.length, 0, 'no batch while another instance owns the event');
    assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, 0);
    assert.strictEqual(db.eventLogRow(event.id), null);
  }
  // Another instance holds the (environment-scoped) processing lock.
  {
    const db = createFakeD1({ users: [user()] });
    const kv = createFakeKV({ [`processing:dev:${event.id}`]: '1' });
    const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
    const res = await postWebhook(onRequest, env, event);
    assert.strictEqual(res.status, 503);
    assert.strictEqual(db.__state.writes, 0, 'locked event touches nothing');
  }
});

await test('grant failure rolls back everything; Stripe retry grants exactly once', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const session = packSession();
  const stub = stubStripeFetch([sessionStub(session), customerStub()]);
  const event = packEvent(session);

  db.failNext('voice_sessions_remaining = voice_sessions_remaining + ?', new Error('D1_ERROR: storage unavailable'));
  const res1 = await postWebhook(onRequest, env, event);
  assert.strictEqual(res1.status, 503, 'write failure is retryable');
  assert.strictEqual(await res1.text(), 'event failed: batch_write_failed');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
  assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, 0, 'no credits after a failed batch');
  assert.strictEqual(db.eventLogRow(event.id), null, 'legacy log insert rolled back with the batch — event not consumed');

  const res2 = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, PACK_SESSION_COUNT, 'retry grants exactly once');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
  assert.strictEqual(db.ledgerRow(event.id)?.attempt_count, 2);
  assert.ok(db.eventLogRow(event.id));
});

await test('event already granted by the legacy (pre-ledger) webhook is recorded as processed, never re-granted', async () => {
  const session = packSession();
  const event = packEvent(session);
  const db = createFakeD1({
    users: [user({ voice_sessions_remaining: PACK_SESSION_COUNT, plan: 'pack', has_ever_paid: 1, pack_expires_at: '2026-12-01T00:00:00.000Z' })],
    stripe_event_log: [{ event_id: event.id, type: 'pack_grant', processed_at: '2026-08-01T00:00:00.000Z' }]
  });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const stub = stubStripeFetch([sessionStub(session), customerStub()]);
  const res = await postWebhook(onRequest, env, event);
  const purchases = ga4Purchases(stub);
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_pack');
  assert.strictEqual(row.voice_sessions_remaining, PACK_SESSION_COUNT, 'credits untouched');
  assert.strictEqual(row.pack_expires_at, '2026-12-01T00:00:00.000Z', 'expiry untouched');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed', 'ledger now records the legacy grant');
  assert.strictEqual(db.__state.batches.length, 1);
  assert.deepStrictEqual(db.__state.batches[0].filter((sql) => sql.startsWith('UPDATE users')), [], 'no users write at all');
  assert.strictEqual(purchases.length, 0, 'no duplicate GA4 purchase');
});

await test('race with the legacy webhook: UNIQUE refusal on stripe_event_log fails the batch (503, retryable), retry records it', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const session = packSession();
  const stub = stubStripeFetch([sessionStub(session), customerStub()]);
  const event = packEvent(session);
  db.failNext('INSERT INTO stripe_event_log', new Error('UNIQUE constraint failed: stripe_event_log.event_id'));
  const res1 = await postWebhook(onRequest, env, event);
  assert.strictEqual(res1.status, 503, 'legacy-log conflict is retryable, not an ownership conflict');
  assert.strictEqual(await res1.text(), 'event failed: event_log_conflict');
  assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, 0, 'nothing credited');
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'event_log_conflict');

  // The old code's grant is now visible in the legacy log; the retry sees it.
  db.__state.tables.stripe_event_log.push({ event_id: event.id, type: 'pack_grant', processed_at: new Date().toISOString() });
  db.usersByAuthId('uid_pack').voice_sessions_remaining = PACK_SESSION_COUNT;
  const res2 = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, PACK_SESSION_COUNT, 'still exactly one grant');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
});

await test('degraded expansion (200 with an error body): mode + plan come from the signed payload; still never essential', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const session = packSession();
  const stub = stubStripeFetch([
    { match: `/v1/checkout/sessions/${session.id}`, reply: { json: { error: { message: 'expansion failed (simulated)' } } } },
    customerStub(null) // customer carries no metadata: uid must come from the signed session metadata
  ]);
  const res = await postWebhook(onRequest, env, packEvent(session));
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_pack');
  assert.strictEqual(row.voice_sessions_remaining, PACK_SESSION_COUNT, 'credits granted despite the degraded expansion');
  assert.strictEqual(row.plan, 'pack', 'plan set by the grant, never essential');
  assert.strictEqual(row.stripe_subscription_id, null);
});

await test('mode missing everywhere with metadata.plan=pack: 500 critical, no grant, no plan write, lock released', async () => {
  const db = createFakeD1({ users: [user()] });
  const kv = createFakeKV();
  const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
  const session = packSession({ mode: undefined });
  delete session.mode;
  const stub = stubStripeFetch([
    { match: `/v1/checkout/sessions/${session.id}`, reply: { json: { error: { message: 'expansion failed (simulated)' } } } },
    customerStub()
  ]);
  const event = packEvent(session);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 500, 'fails closed so Stripe retries');
  assert.strictEqual(await res.text(), 'event failed: pack_mode_unresolved');
  const row = db.usersByAuthId('uid_pack');
  assert.strictEqual(row.voice_sessions_remaining, 0);
  assert.strictEqual(row.plan, 'free', 'plan untouched — never essential');
  assert.strictEqual(db.__state.batches.length, 0, 'no batch committed');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'pack_mode_unresolved');
  assert.ok(!kv.__map.has(`processing:dev:${event.id}`), 'processing lock released for retry');
  assert.ok(!kv.__map.has(`evtl:dev:${event.id}`) && !kv.__map.has(`evt:${event.id}`), 'no success marker written');
});

await test('unrecognized one-time payment (mode=payment, unknown price, no plan): 500 critical, nothing written', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const session = packSession({ metadata: { firebaseUid: 'uid_pack' } });
  const stub = stubStripeFetch([
    { match: `/v1/checkout/sessions/${session.id}`, reply: { json: { ...session, line_items: { data: [{ price: { id: 'price_mystery', unit_amount: 500 } }] }, amount_total: 500, currency: 'usd' } } },
    customerStub()
  ]);
  const event = packEvent(session);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 500);
  assert.strictEqual(await res.text(), 'event failed: unrecognized_one_time_payment');
  assert.strictEqual(db.usersByAuthId('uid_pack').plan, 'free');
  assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, 0);
  assert.strictEqual(db.__state.batches.length, 0);
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
});

await test('wrong-mode pack event (livemode=true in dev): acknowledged with zero D1 and zero KV writes', async () => {
  const db = createFakeD1({ users: [user()] });
  const kv = createFakeKV();
  const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
  const event = packEvent(packSession(), { livemode: true });
  const res = await postWebhook(onRequest, env, event);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), '[ignored-wrong-mode]');
  assert.strictEqual(db.__state.writes, 0);
  assert.strictEqual(kv.writeCount, 0);
  assert.strictEqual(db.ledgerRow(event.id), null);
  assert.strictEqual(db.eventLogRow(event.id), null);
  assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, 0);
});

await test('first-time buyer without a users row is created and granted; a tombstoned account is a no-op', async () => {
  {
    const db = createFakeD1({ users: [] });
    const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
    const session = packSession();
    const stub = stubStripeFetch([sessionStub(session), customerStub()]);
    const res = await postWebhook(onRequest, env, packEvent(session));
    stub.restore();
    assert.strictEqual(res.status, 200);
    const row = db.usersByAuthId('uid_pack');
    assert.ok(row, 'user row created');
    assert.strictEqual(row.voice_sessions_remaining, PACK_SESSION_COUNT);
    assert.strictEqual(row.plan, 'pack');
  }
  {
    const db = createFakeD1({ users: [], deleted_auth_ids: [{ auth_id: 'uid_pack', email: 'p@example.com' }] });
    const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
    const session = packSession();
    const stub = stubStripeFetch([sessionStub(session), customerStub()]);
    const event = packEvent(session);
    const res = await postWebhook(onRequest, env, event);
    stub.restore();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(db.usersByAuthId('uid_pack'), null, 'deleted account is not resurrected');
    assert.strictEqual(db.eventLogRow(event.id), null, 'no grant recorded');
    assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed', 'deliberate no-op is still marked processed');
  }
});

await test('an active monthly subscriber buying a pack keeps plan=monthly and gains credits; subscription fields untouched', async () => {
  const db = createFakeD1({ users: [user({ plan: 'monthly', subscription_status: 'active', stripe_customer_id: 'cus_pack_1', stripe_subscription_id: 'sub_m1', current_period_end: '2026-10-01T00:00:00.000Z', has_ever_paid: 1 })] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const session = packSession();
  const stub = stubStripeFetch([sessionStub(session), customerStub()]);
  const res = await postWebhook(onRequest, env, packEvent(session));
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_pack');
  assert.strictEqual(row.plan, 'monthly', 'subscription plan wins over the pack label');
  assert.strictEqual(row.voice_sessions_remaining, PACK_SESSION_COUNT);
  assert.strictEqual(row.stripe_subscription_id, 'sub_m1');
  assert.strictEqual(row.current_period_end, '2026-10-01T00:00:00.000Z');
});

await test('unresolved owner (no metadata anywhere): 500 critical, ledger failed, no writes', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const session = packSession({ metadata: { plan: 'pack' } });
  const stub = stubStripeFetch([sessionStub(session), customerStub(null)]);
  const event = packEvent(session);
  const res = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res.status, 500);
  assert.strictEqual(await res.text(), 'event failed: unresolved_owner');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
  assert.strictEqual(db.__state.batches.length, 0);
  assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, 0);
});

await test('session fetch failure (non-2xx) is a retryable 503 with no writes; the retry grants exactly once', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const session = packSession();
  const event = packEvent(session);
  let stub = stubStripeFetch([{ match: `/v1/checkout/sessions/${session.id}`, reply: { status: 500, json: { error: { message: 'boom' } } } }, customerStub()]);
  const res1 = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res1.status, 503);
  assert.strictEqual(await res1.text(), 'event failed: session_fetch_failed');
  assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, 0);
  assert.strictEqual(db.__state.batches.length, 0);

  stub = stubStripeFetch([sessionStub(session), customerStub()]);
  const res2 = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_pack').voice_sessions_remaining, PACK_SESSION_COUNT);
  assert.strictEqual(db.ledgerRow(event.id)?.attempt_count, 2);
});

await test('a subscription checkout still takes the subscription path (regression guard for the mode branch)', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const START = 1755000000, END = 1757678400;
  const session = { id: 'cs_sub_1', mode: 'subscription', status: 'complete', payment_status: 'paid', customer: 'cus_pack_1', metadata: { plan: 'monthly', firebaseUid: 'uid_pack' }, customer_details: { email: 'p@example.com' } };
  const stub = stubStripeFetch([
    { match: '/v1/checkout/sessions/cs_sub_1', reply: { json: { ...session, line_items: { data: [{ price: { id: 'price_monthly_test', unit_amount: 3400 } }] }, subscription: 'sub_co_m', amount_total: 3400, currency: 'usd' } } },
    { match: '/v1/subscriptions/sub_co_m', reply: { json: makeSubscription({ id: 'sub_co_m', customer: 'cus_pack_1', priceId: 'price_monthly_test', itemPeriodStart: START, itemPeriodEnd: END }) } },
    customerStub()
  ]);
  const res = await postWebhook(onRequest, env, makeEvent('checkout.session.completed', session, { livemode: false }));
  stub.restore();
  assert.strictEqual(res.status, 200);
  const row = db.usersByAuthId('uid_pack');
  assert.strictEqual(row.plan, 'monthly');
  assert.strictEqual(row.stripe_subscription_id, 'sub_co_m');
  assert.strictEqual(row.voice_sessions_remaining, 0, 'no pack credits from a subscription checkout');
  assert.strictEqual(db.eventLogRow(res.id), null);
});

// ── Codex finding: a grant must never be acknowledged without a recipient ──
// The row passes ensureUserRow, then vanishes before the batch executes
// (concurrent account deletion). Without the recipient guard the batch would
// commit the legacy-log row and the processed-mark with a zero-row UPDATE.
function vanishBeforeBatch(db, uid) {
  const realBatch = db.batch.bind(db);
  db.batch = async (stmts) => {
    db.__state.tables.users = db.__state.tables.users.filter((u) => u.auth_id !== uid);
    return realBatch(stmts);
  };
  return () => { db.batch = realBatch; };
}

await test('recipient row vanishes between ensureUserRow and the batch: whole batch rolls back (503), retry grants exactly once', async () => {
  const db = createFakeD1({ users: [user()] });
  const kv = createFakeKV();
  const env = devEnv({ DB: db, JOBHACKAI_KV: kv });
  const session = packSession();
  const event = packEvent(session);
  const stub = stubStripeFetch([sessionStub(session), customerStub()]);
  const restoreBatch = vanishBeforeBatch(db, 'uid_pack');
  const res1 = await postWebhook(onRequest, env, event);
  restoreBatch();
  assert.strictEqual(res1.status, 503, 'retryable — never a false success');
  assert.strictEqual(await res1.text(), 'event failed: recipient_row_missing');
  assert.strictEqual(db.eventLogRow(event.id), null, 'legacy idempotency row rolled back — event not consumed');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'failed');
  assert.strictEqual(db.ledgerRow(event.id)?.last_error, 'recipient_row_missing');
  assert.strictEqual(db.usersByAuthId('uid_pack'), null, 'no recipient existed to credit');
  assert.ok(!kv.__map.has(`evtl:dev:${event.id}`), 'no success marker');
  assert.ok(!kv.__map.has(`processing:dev:${event.id}`), 'lock released');

  // Stripe retries; no tombstone exists, so ensureUserRow re-creates the row and the grant lands once.
  const res2 = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res2.status, 200);
  const row = db.usersByAuthId('uid_pack');
  assert.ok(row, 'row re-created by the retry');
  assert.strictEqual(row.voice_sessions_remaining, PACK_SESSION_COUNT, 'exactly one grant across the failed attempt and the retry');
  assert.ok(db.eventLogRow(event.id));
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed');
  assert.strictEqual(db.ledgerRow(event.id)?.attempt_count, 2);
});

await test('recipient vanishes and a tombstone is written: the retry is a recorded no-op, nothing granted, nothing resurrected', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const session = packSession();
  const event = packEvent(session);
  const stub = stubStripeFetch([sessionStub(session), customerStub()]);
  const restoreBatch = vanishBeforeBatch(db, 'uid_pack');
  const res1 = await postWebhook(onRequest, env, event);
  restoreBatch();
  assert.strictEqual(res1.status, 503);
  // The deletion flow also leaves its tombstone.
  db.__state.tables.deleted_auth_ids.push({ auth_id: 'uid_pack', email: 'p@example.com' });
  const res2 = await postWebhook(onRequest, env, event);
  stub.restore();
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(db.usersByAuthId('uid_pack'), null, 'deleted account is not resurrected');
  assert.strictEqual(db.eventLogRow(event.id), null, 'no grant recorded for a deleted account');
  assert.strictEqual(db.ledgerRow(event.id)?.status, 'processed', 'deliberate tombstone no-op is recorded as processed');
  assert.deepStrictEqual(db.__state.batches.at(-1).filter((sql) => !sql.startsWith('UPDATE stripe_event_ledger')), [], 'the no-op batch carries only the processed-mark');
});

await test('the guarded processed-mark is used only when a recipient write was staged (plain mark for pure no-ops)', async () => {
  const db = createFakeD1({ users: [user()] });
  const env = devEnv({ DB: db, JOBHACKAI_KV: createFakeKV() });
  const session = packSession();
  const stub = stubStripeFetch([sessionStub(session), customerStub()]);
  await postWebhook(onRequest, env, packEvent(session));
  stub.restore();
  const mark = db.__state.batches[0].at(-1);
  assert.ok(mark.includes('CASE WHEN (SELECT COUNT(*) FROM users WHERE auth_id IN ('), 'grant batch carries the recipient guard');
});

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
