// Voice entitlements test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/voice-entitlements.test.mjs
//
// Covers the acceptance criteria from docs/jobhackai-pr-sequence.md PR 2/6:
// - pack purchase grants exactly 5 credits with 90-day expiry
// - replayed grant events do not double-grant (D1-level idempotency)
// - free users get exactly 1 lifetime session; second consume fails
// - pack credits decrement atomically, never below zero
// - active subscribers (new and grandfathered legacy plans) are unlimited,
//   bounded by the fair-use cap
// - canceled/expired subscriptions fall through to pack/free/paywall

import assert from 'node:assert/strict';
import {
  getVoiceEntitlement,
  consumeVoiceSession,
  refundVoiceSession,
  createVoiceSessionRow,
  grantPackCredits,
  voiceFeatureEnabled,
  fairUseCap,
  PACK_SESSION_COUNT,
  PACK_EXPIRY_DAYS
} from '../voice-entitlements.js';

// ---------- Minimal in-memory fake D1 ----------

function fakeDb(state) {
  // state: { users: Map<auth_id, row>, eventLog: Set<string>, sessionCount: number }
  const exec = (sql, binds) => {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('INSERT INTO voice_sessions')) {
      if (q.includes('VALUES')) {
        // Unconditional insert (free/pack); consume already gated it.
        state.sessionCount = (state.sessionCount || 0) + 1;
        return { run: { meta: { changes: 1 } } };
      }
      // Conditional INSERT ... SELECT ... WHERE count < cap (subscription).
      const cap = binds[binds.length - 1];
      if ((state.sessionCount || 0) < cap) {
        state.sessionCount = (state.sessionCount || 0) + 1;
        return { run: { meta: { changes: 1 } } };
      }
      return { run: { meta: { changes: 0 } } };
    }

    if (q.startsWith('SELECT id, plan, subscription_status')) {
      const row = state.users.get(binds[0]) || null;
      return { first: row ? { ...row } : null };
    }
    if (q.startsWith('SELECT COUNT(*) AS n FROM voice_sessions')) {
      return { first: { n: state.sessionCount || 0 } };
    }
    if (q.includes('voice_sessions_remaining = voice_sessions_remaining - 1')) {
      const row = state.users.get(binds[0]);
      if (row && row.voice_sessions_remaining > 0) {
        row.voice_sessions_remaining -= 1;
        return { run: { meta: { changes: 1 } } };
      }
      return { run: { meta: { changes: 0 } } };
    }
    if (q.includes('SET free_session_used = 1')) {
      const row = state.users.get(binds[0]);
      if (row && !row.free_session_used) {
        row.free_session_used = 1;
        return { run: { meta: { changes: 1 } } };
      }
      return { run: { meta: { changes: 0 } } };
    }
    if (q.includes('SET free_session_used = 0')) {
      const row = state.users.get(binds[0]);
      if (row) row.free_session_used = 0;
      return { run: { meta: { changes: row ? 1 : 0 } } };
    }
    if (q.includes('voice_sessions_remaining = voice_sessions_remaining + 1')) {
      const row = state.users.get(binds[0]);
      if (row) row.voice_sessions_remaining += 1;
      return { run: { meta: { changes: row ? 1 : 0 } } };
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

function makeEnv(state, extra = {}) {
  return { DB: fakeDb(state), ...extra };
}

function userRow(over = {}) {
  return {
    id: 1,
    plan: 'free',
    subscription_status: null,
    current_period_end: null,
    voice_sessions_remaining: 0,
    free_session_used: 0,
    pack_expires_at: null,
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

console.log('voice-entitlements test suite\n');

await test('feature flag parses truthily only for "true"', () => {
  assert.equal(voiceFeatureEnabled({ VOICE_INTERVIEW_ENABLED: 'true' }), true);
  assert.equal(voiceFeatureEnabled({ VOICE_INTERVIEW_ENABLED: 'TRUE' }), true);
  assert.equal(voiceFeatureEnabled({ VOICE_INTERVIEW_ENABLED: 'false' }), false);
  assert.equal(voiceFeatureEnabled({}), false);
});

await test('fair use cap defaults to 60 and honors env override', () => {
  assert.equal(fairUseCap({}), 60);
  assert.equal(fairUseCap({ VOICE_FAIR_USE_CAP: '40' }), 40);
  assert.equal(fairUseCap({ VOICE_FAIR_USE_CAP: 'junk' }), 60);
});

await test('brand-new account (no row) gets the free taste', async () => {
  const state = { users: new Map(), eventLog: new Set(), sessionCount: 0 };
  const ent = await getVoiceEntitlement(makeEnv(state), 'uid-new');
  assert.equal(ent.canStart, true);
  assert.equal(ent.mode, 'free');
});

await test('free user: 1 lifetime session, second consume fails, then paywall', async () => {
  const state = { users: new Map([['u1', userRow()]]), eventLog: new Set(), sessionCount: 0 };
  const env = makeEnv(state);

  const ent1 = await getVoiceEntitlement(env, 'u1');
  assert.equal(ent1.canStart, true);
  assert.equal(ent1.mode, 'free');

  assert.equal(await consumeVoiceSession(env, 'u1', 'free'), true);
  assert.equal(await consumeVoiceSession(env, 'u1', 'free'), false, 'double consume must fail');

  const ent2 = await getVoiceEntitlement(env, 'u1');
  assert.equal(ent2.canStart, false);
  assert.equal(ent2.reason, 'paywall');
  assert.equal(ent2.freeSessionUsed, true);
});

await test('pack grant: exactly 5 credits, ~90 day expiry, plan set for free users', async () => {
  const state = { users: new Map([['u2', userRow({ free_session_used: 1 })]]), eventLog: new Set(), sessionCount: 0 };
  const env = makeEnv(state);

  const res = await grantPackCredits(env, 'u2', 'evt_1');
  assert.equal(res.granted, true);
  const row = state.users.get('u2');
  assert.equal(row.voice_sessions_remaining, PACK_SESSION_COUNT);
  assert.equal(row.plan, 'pack');
  const expiresMs = new Date(row.pack_expires_at).getTime();
  const expectedMs = Date.now() + PACK_EXPIRY_DAYS * 86400000;
  assert.ok(Math.abs(expiresMs - expectedMs) < 60000, 'expiry should be ~90 days out');
});

await test('pack grant on a missing user row releases the lock so a retry can succeed', async () => {
  const state = { users: new Map(), eventLog: new Set(), sessionCount: 0 };
  const env = makeEnv(state);

  // User row not created yet (e.g. getOrCreateUserByAuthId failed transiently)
  const r1 = await grantPackCredits(env, 'ghost', 'evt_missing');
  assert.equal(r1.granted, false);
  assert.equal(r1.duplicate, false, 'a failed grant must NOT report as duplicate');
  assert.equal(state.eventLog.has('evt_missing'), false, 'idempotency lock must be released for retry');

  // Stripe retries; this time the row exists and the grant succeeds
  state.users.set('ghost', userRow());
  const r2 = await grantPackCredits(env, 'ghost', 'evt_missing');
  assert.equal(r2.granted, true);
  assert.equal(state.users.get('ghost').voice_sessions_remaining, PACK_SESSION_COUNT);
});

await test('pack grant is idempotent on replayed event ids', async () => {
  const state = { users: new Map([['u3', userRow()]]), eventLog: new Set(), sessionCount: 0 };
  const env = makeEnv(state);

  await grantPackCredits(env, 'u3', 'evt_dup');
  const res2 = await grantPackCredits(env, 'u3', 'evt_dup');
  assert.equal(res2.duplicate, true);
  assert.equal(res2.granted, false);
  assert.equal(state.users.get('u3').voice_sessions_remaining, PACK_SESSION_COUNT, 'no double grant');
});

await test('pack credits decrement atomically and never below zero', async () => {
  const state = {
    users: new Map([['u4', userRow({ plan: 'pack', free_session_used: 1, voice_sessions_remaining: 2, pack_expires_at: new Date(Date.now() + 86400000).toISOString() })]]),
    eventLog: new Set(), sessionCount: 0
  };
  const env = makeEnv(state);

  const ent = await getVoiceEntitlement(env, 'u4');
  assert.equal(ent.canStart, true);
  assert.equal(ent.mode, 'pack');
  assert.equal(ent.sessionsRemaining, 2);

  assert.equal(await consumeVoiceSession(env, 'u4', 'pack'), true);
  assert.equal(await consumeVoiceSession(env, 'u4', 'pack'), true);
  assert.equal(await consumeVoiceSession(env, 'u4', 'pack'), false, 'no credits left');
  assert.equal(state.users.get('u4').voice_sessions_remaining, 0);

  const ent2 = await getVoiceEntitlement(env, 'u4');
  assert.equal(ent2.canStart, false);
  assert.equal(ent2.reason, 'paywall');
});

await test('expired pack credits do not grant access', async () => {
  const state = {
    users: new Map([['u5', userRow({ plan: 'pack', free_session_used: 1, voice_sessions_remaining: 3, pack_expires_at: new Date(Date.now() - 86400000).toISOString() })]]),
    eventLog: new Set(), sessionCount: 0
  };
  const ent = await getVoiceEntitlement(makeEnv(state), 'u5');
  assert.equal(ent.canStart, false);
  assert.equal(ent.reason, 'paywall');
});

await test('concurrent starts cannot double-spend without a KV lock (atomic consume is the guard)', async () => {
  // Free taste: two racing requests, only one consume may win.
  const free = { users: new Map([['r', userRow()]]), eventLog: new Set(), sessionCount: 0 };
  const fenv = makeEnv(free);
  const a = await consumeVoiceSession(fenv, 'r', 'free');
  const b = await consumeVoiceSession(fenv, 'r', 'free');
  assert.equal(a, true);
  assert.equal(b, false, 'second concurrent free consume must fail');

  // Pack with a single credit: two racing requests, only one may win.
  const pack = { users: new Map([['p', userRow({ plan: 'pack', voice_sessions_remaining: 1 })]]), eventLog: new Set(), sessionCount: 0 };
  const penv = makeEnv(pack);
  const c = await consumeVoiceSession(penv, 'p', 'pack');
  const d = await consumeVoiceSession(penv, 'p', 'pack');
  assert.equal(c, true);
  assert.equal(d, false, 'second concurrent pack consume must fail on the last credit');
  assert.equal(pack.users.get('p').voice_sessions_remaining, 0, 'credits never go negative');
});

await test('refund restores a pack credit and the free taste', async () => {
  const state = { users: new Map([['u6', userRow({ voice_sessions_remaining: 1, free_session_used: 1 })]]), eventLog: new Set(), sessionCount: 0 };
  const env = makeEnv(state);
  await refundVoiceSession(env, 'u6', 'pack');
  assert.equal(state.users.get('u6').voice_sessions_remaining, 2);
  await refundVoiceSession(env, 'u6', 'free');
  assert.equal(state.users.get('u6').free_session_used, 0);
});

await test('monthly subscriber is unlimited within the fair-use cap', async () => {
  const state = {
    users: new Map([['u7', userRow({ plan: 'monthly', subscription_status: 'active', free_session_used: 1, current_period_end: new Date(Date.now() + 7 * 86400000).toISOString() })]]),
    eventLog: new Set(), sessionCount: 10
  };
  const env = makeEnv(state);
  const ent = await getVoiceEntitlement(env, 'u7');
  assert.equal(ent.canStart, true);
  assert.equal(ent.mode, 'subscription');
  assert.equal(ent.unlimited, true);
  assert.equal(await consumeVoiceSession(env, 'u7', 'subscription'), true);
});

await test('fair-use cap blocks the 61st session this month', async () => {
  const state = {
    users: new Map([['u8', userRow({ plan: 'monthly', subscription_status: 'active', current_period_end: new Date(Date.now() + 7 * 86400000).toISOString() })]]),
    eventLog: new Set(), sessionCount: 60
  };
  const ent = await getVoiceEntitlement(makeEnv(state), 'u8');
  assert.equal(ent.canStart, false);
  assert.equal(ent.reason, 'limit_reached');
});

await test('grandfathering: active legacy pro subscription is unlimited', async () => {
  const state = {
    users: new Map([['u9', userRow({ plan: 'pro', subscription_status: 'active', free_session_used: 1, current_period_end: new Date(Date.now() + 7 * 86400000).toISOString() })]]),
    eventLog: new Set(), sessionCount: 0
  };
  const ent = await getVoiceEntitlement(makeEnv(state), 'u9');
  assert.equal(ent.canStart, true);
  assert.equal(ent.mode, 'subscription');
  assert.equal(ent.unlimited, true);
});

await test('hasEverPaid is surfaced so a paid-then-lapsed user keeps their free session unlocked', async () => {
  // Used the free taste, paid once (pack), but credits now lapsed and no sub.
  const state = {
    users: new Map([['paid', userRow({ plan: 'free', free_session_used: 1, voice_sessions_remaining: 0, has_ever_paid: 1 })]]),
    eventLog: new Set(), sessionCount: 0
  };
  const ent = await getVoiceEntitlement(makeEnv(state), 'paid');
  assert.equal(ent.canStart, false);
  assert.equal(ent.reason, 'paywall', 'cannot start a NEW session without credits');
  assert.equal(ent.hasEverPaid, true, 'but the read endpoints use this to keep the free report unlocked');

  // Never-paid user: hasEverPaid is false.
  const state2 = {
    users: new Map([['nope', userRow({ plan: 'free', free_session_used: 1, voice_sessions_remaining: 0, has_ever_paid: 0 })]]),
    eventLog: new Set(), sessionCount: 0
  };
  const ent2 = await getVoiceEntitlement(makeEnv(state2), 'nope');
  assert.equal(ent2.hasEverPaid, false);
});

await test('paid plan label with null Stripe state does NOT grant unlimited voice', async () => {
  // Stale/legacy row: plan='pro' but no live subscription status or period.
  const state = {
    users: new Map([['x', userRow({ plan: 'pro', subscription_status: null, current_period_end: null, free_session_used: 0 })]]),
    eventLog: new Set(), sessionCount: 0
  };
  const ent = await getVoiceEntitlement(makeEnv(state), 'x');
  assert.equal(ent.unlimited, false, 'no active status must not grant unlimited');
  assert.equal(ent.mode, 'free', 'falls through to the free taste');
  assert.equal(ent.canStart, true);

  // Same, but the free taste is already spent -> paywall, never unlimited.
  const state2 = {
    users: new Map([['y', userRow({ plan: 'premium', subscription_status: null, current_period_end: null, free_session_used: 1 })]]),
    eventLog: new Set(), sessionCount: 0
  };
  const ent2 = await getVoiceEntitlement(makeEnv(state2), 'y');
  assert.equal(ent2.canStart, false);
  assert.equal(ent2.reason, 'paywall');
});

await test('createVoiceSessionRow enforces the fair-use cap atomically for subscriptions', async () => {
  const env = makeEnv({ users: new Map(), eventLog: new Set(), sessionCount: 59 }, { VOICE_FAIR_USE_CAP: '60' });
  const a = await createVoiceSessionRow(env, { sessionId: 's60', userRowId: 1, role: 'X', seniority: null, jd: null, mode: 'subscription', model: 'm' });
  assert.equal(a.inserted, true, '60th session (count was 59) is allowed');
  const b = await createVoiceSessionRow(env, { sessionId: 's61', userRowId: 1, role: 'X', seniority: null, jd: null, mode: 'subscription', model: 'm' });
  assert.equal(b.inserted, false, '61st session is blocked at the cap');
  assert.equal(b.reason, 'limit_reached');
});

await test('createVoiceSessionRow always inserts for free/pack (consume already gated)', async () => {
  const env = makeEnv({ users: new Map(), eventLog: new Set(), sessionCount: 999 }, { VOICE_FAIR_USE_CAP: '60' });
  const f = await createVoiceSessionRow(env, { sessionId: 'f1', userRowId: 1, role: 'X', seniority: null, jd: null, mode: 'free', model: 'm' });
  assert.equal(f.inserted, true);
  const p = await createVoiceSessionRow(env, { sessionId: 'p1', userRowId: 1, role: 'X', seniority: null, jd: null, mode: 'pack', model: 'm' });
  assert.equal(p.inserted, true);
});

await test('canceled subscription falls back to free taste / paywall', async () => {
  const state = {
    users: new Map([['u10', userRow({ plan: 'free', subscription_status: 'canceled', free_session_used: 0 })]]),
    eventLog: new Set(), sessionCount: 0
  };
  const env = makeEnv(state);
  const ent = await getVoiceEntitlement(env, 'u10');
  assert.equal(ent.canStart, true);
  assert.equal(ent.mode, 'free', 'canceled subscriber still has unused free taste');

  await consumeVoiceSession(env, 'u10', 'free');
  const ent2 = await getVoiceEntitlement(env, 'u10');
  assert.equal(ent2.canStart, false);
  assert.equal(ent2.reason, 'paywall');
});

await test('stale current_period_end (beyond grace) blocks subscription access', async () => {
  const state = {
    users: new Map([['u11', userRow({ plan: 'weekly', subscription_status: 'active', free_session_used: 1, current_period_end: new Date(Date.now() - 10 * 86400000).toISOString() })]]),
    eventLog: new Set(), sessionCount: 0
  };
  const ent = await getVoiceEntitlement(makeEnv(state), 'u11');
  assert.equal(ent.canStart, false);
  assert.equal(ent.reason, 'paywall');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
