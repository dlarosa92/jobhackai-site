// Stripe webhook pack fail-safe test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/stripe-webhook-pack.test.mjs
//
// Guards the pack fallback fixed after PR #834: a one-time Interview Pack
// purchase must never fall through to the subscription plan-mapping path
// (which writes plan='essential' and grants unlimited voice) when the
// checkout session expansion re-fetch fails.
// - expansion fails but the signed event carries mode=payment +
//   metadata.plan=pack -> 200, credits granted, no 'essential' write
// - mode missing everywhere -> 500 and idempotency keys released so
//   Stripe's retry is actually reprocessed

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequest } from '../../api/stripe-webhook.js';
import { PACK_SESSION_COUNT } from '../voice-entitlements.js';

// ---------- Minimal in-memory fake D1 ----------

function fakeDb(state) {
  // state: { users: Map<auth_id, row>, eventLog: Set<string>, planWrites: [] }
  const exec = (sql, binds) => {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('SELECT id FROM users WHERE auth_id = ?')) {
      const row = state.users.get(binds[0]) || null;
      return { first: row ? { id: row.id } : null };
    }
    if (q.startsWith('SELECT 1 FROM deleted_auth_ids')) {
      return { first: null };
    }
    if (q.startsWith('INSERT OR IGNORE INTO stripe_event_log')) {
      if (state.eventLog.has(binds[0])) return { run: { meta: { changes: 0 } } };
      state.eventLog.add(binds[0]);
      return { run: { meta: { changes: 1 } } };
    }
    if (q.startsWith('DELETE FROM stripe_event_log')) {
      const had = state.eventLog.delete(binds[0]);
      return { run: { meta: { changes: had ? 1 : 0 } } };
    }
    if (q.includes('voice_sessions_remaining = voice_sessions_remaining + ?')) {
      const [count, expires, uid] = binds;
      const row = state.users.get(uid);
      if (!row) return { run: { meta: { changes: 0 } } };
      row.voice_sessions_remaining += count;
      row.pack_expires_at = expires;
      row.has_ever_paid = 1;
      if (!row.plan || row.plan === '' || row.plan === 'free') row.plan = 'pack';
      return { run: { meta: { changes: 1 } } };
    }
    // Subscription path (updatePlanInD1 -> getUserPlanData / updateUserPlan).
    // Handled so a regression that falls through records the bad write
    // instead of throwing into the webhook's catch-all (which returns 200).
    if (q.startsWith('SELECT plan, stripe_customer_id')) {
      const row = state.users.get(binds[0]) || null;
      return { first: row ? { plan: row.plan, plan_updated_at: null } : null };
    }
    if (q.startsWith('SELECT has_ever_paid FROM users')) {
      return { first: { has_ever_paid: 0 } };
    }
    if (q.startsWith('UPDATE users SET plan = ?')) {
      state.planWrites.push({ plan: binds[0], uid: binds[binds.length - 1] });
      const row = state.users.get(binds[binds.length - 1]);
      if (row) row.plan = binds[0];
      return { run: { meta: { changes: row ? 1 : 0 } } };
    }
    throw new Error(`fakeDb: unhandled SQL: ${q}`);
  };

  return {
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            async first() { return exec(sql, binds).first ?? null; },
            async run() {
              const r = exec(sql, binds);
              return r.run ?? { meta: { changes: 0 } };
            }
          };
        }
      };
    }
  };
}

// ---------- Minimal in-memory fake KV ----------

function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); }
  };
}

// ---------- Fake Stripe API (global fetch) ----------

// Simulates the session expansion re-fetch failing: the sessions endpoint
// returns an error payload with no mode/line_items, and the customer has no
// firebaseUid metadata (uid must resolve from the event's session metadata).
function installFakeFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body = {};
    if (u.includes('/v1/checkout/sessions/')) {
      body = { error: { message: 'expansion failed (simulated)' } };
    } else if (u.includes('/v1/customers/')) {
      body = {};
    }
    return {
      ok: true,
      status: 200,
      async json() { return body; },
      async text() { return JSON.stringify(body); }
    };
  };
}

// ---------- Signed webhook request helpers ----------

const WEBHOOK_SECRET = 'whsec_test_secret';

function signedRequest(event) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return {
    method: 'POST',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'stripe-signature' ? `t=${t},v1=${v1}` : null;
      }
    },
    async text() { return raw; }
  };
}

function makeContext(state, kv, event) {
  const env = {
    DB: fakeDb(state),
    JOBHACKAI_KV: kv,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_PRICE_PACK: 'price_pack_test'
  };
  return { request: signedRequest(event), env, waitUntil() { /* fire-and-forget */ } };
}

function userRow(over = {}) {
  return {
    id: 1,
    plan: 'free',
    voice_sessions_remaining: 0,
    free_session_used: 0,
    pack_expires_at: null,
    has_ever_paid: 0,
    ...over
  };
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
  }
}

// ---------- Tests ----------

console.log('stripe-webhook pack fail-safe test suite\n');

installFakeFetch();

await test('expansion fails but event carries mode=payment + plan=pack: 200, credits granted, no essential write', async () => {
  const state = { users: new Map([['uid-pack', userRow()]]), eventLog: new Set(), planWrites: [] };
  const kv = fakeKv();
  const event = {
    id: 'evt_pack_ok',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_pack_1',
        mode: 'payment',
        customer: 'cus_pack_1',
        metadata: { plan: 'pack', firebaseUid: 'uid-pack' }
      }
    }
  };

  const res = await onRequest(makeContext(state, kv, event));
  assert.equal(res.status, 200);

  const row = state.users.get('uid-pack');
  assert.equal(row.voice_sessions_remaining, PACK_SESSION_COUNT, 'pack credits granted despite failed expansion');
  assert.equal(row.plan, 'pack', 'plan set by the grant, not the subscription path');
  assert.equal(state.planWrites.length, 0, 'no subscription-path plan write may occur');
  assert.ok(state.eventLog.has('evt_pack_ok'), 'grant idempotency record kept after success');
});

await test('mode missing everywhere: 500, no grant, no essential write, idempotency keys released', async () => {
  const state = { users: new Map([['uid-lost', userRow()]]), eventLog: new Set(), planWrites: [] };
  const kv = fakeKv();
  const event = {
    id: 'evt_pack_lost',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_pack_2',
        // mode deliberately absent
        customer: 'cus_pack_2',
        metadata: { plan: 'pack', firebaseUid: 'uid-lost' }
      }
    }
  };

  const res = await onRequest(makeContext(state, kv, event));
  assert.equal(res.status, 500, 'must fail closed so Stripe retries');
  assert.equal(await res.text(), 'pack mode unresolved');

  const row = state.users.get('uid-lost');
  assert.equal(row.voice_sessions_remaining, 0, 'no credits granted');
  assert.equal(row.plan, 'free', 'plan untouched — never essential');
  assert.equal(state.planWrites.length, 0, 'no subscription-path plan write may occur');
  assert.equal(kv.store.has('evt:evt_pack_lost'), false, 'dedup key released for retry');
  assert.equal(kv.store.has('processing:evt_pack_lost'), false, 'processing lock released for retry');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
