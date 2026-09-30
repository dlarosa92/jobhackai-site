// Voice session history test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/voice-history.test.mjs
//
// Covers the history rail acceptance criteria:
// - list returns at most 10 newest completed sessions, ownership enforced
// - free user's aged session (90-day lapse) stays listed with reportAvailable:false
// - paid/entitled user's aged sessions are excluded, like typed sessions
// - overall score only surfaces with full access + a ready scorecard
// - delete and clear enforce ownership in SQL

import assert from 'node:assert/strict';
import {
  listVoiceSessions,
  deleteVoiceSession,
  clearVoiceSessions,
  isSessionExpired,
  hasActiveVoicePlan,
  sessionFullAccess,
  parseDbTime,
  HISTORY_LIMIT,
  HISTORY_RETENTION_DAYS
} from '../voice-history.js';

// ---------- Minimal in-memory fake D1 ----------

function fakeDb(state) {
  // state: { sessions: Array<row> } — rows use the voice_sessions column names
  const exec = (sql, binds) => {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('SELECT id, role, seniority, status, entitlement_mode')) {
      const userId = binds[0];
      const rows = state.sessions
        .filter((s) => s.user_id === userId && s.status === 'completed')
        .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
        .slice(0, 25)
        .map((s) => ({ ...s }));
      return { all: { results: rows } };
    }
    if (q.startsWith('DELETE FROM voice_sessions WHERE id = ? AND user_id = ?')) {
      const [id, userId] = binds;
      const keepInFlight = q.includes("status NOT IN ('created', 'active')");
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((s) =>
        !(String(s.id) === String(id) && s.user_id === userId
          && !(keepInFlight && (s.status === 'created' || s.status === 'active'))));
      return { run: { meta: { changes: before - state.sessions.length } } };
    }
    if (q.startsWith('DELETE FROM voice_sessions WHERE user_id = ?')) {
      const userId = binds[0];
      const keepInFlight = q.includes("status NOT IN ('created', 'active')");
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((s) =>
        s.user_id !== userId || (keepInFlight && (s.status === 'created' || s.status === 'active'))
      );
      return { run: { meta: { changes: before - state.sessions.length } } };
    }
    throw new Error(`fakeDb: unhandled SQL: ${q}`);
  };

  return {
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            async first() { return exec(sql, binds).first ?? null; },
            async all() { return exec(sql, binds).all ?? { results: [] }; },
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

function makeEnv(state) {
  return { DB: fakeDb(state) };
}

// Fixed "now" so age math is deterministic.
const NOW = Date.parse('2026-07-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function dbTime(daysAgo) {
  return new Date(NOW - daysAgo * DAY).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

let nextId = 0;
function sessionRow(over = {}) {
  nextId += 1;
  return {
    id: `s-${nextId}`,
    user_id: 1,
    role: 'Data Engineer',
    seniority: 'Senior',
    status: 'completed',
    entitlement_mode: 'free',
    started_at: dbTime(1),
    duration_seconds: 840,
    scorecard_json: JSON.stringify({ overall: 78 }),
    ...over
  };
}

const FREE_ENT = { unlimited: false, sessionsRemaining: 0, hasEverPaid: false };
const SUB_ENT = { unlimited: true, sessionsRemaining: 0, hasEverPaid: true };
const PACK_ENT = { unlimited: false, sessionsRemaining: 3, hasEverPaid: true };
const LAPSED_PAID_ENT = { unlimited: false, sessionsRemaining: 0, hasEverPaid: true };

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

console.log('voice-history test suite\n');

await test('parseDbTime handles D1 datetime and ISO strings as UTC', () => {
  assert.equal(parseDbTime('2026-07-01 12:00:00'), Date.parse('2026-07-01T12:00:00Z'));
  assert.equal(parseDbTime('2026-07-01T12:00:00Z'), Date.parse('2026-07-01T12:00:00Z'));
  assert.ok(Number.isNaN(parseDbTime(null)));
});

await test('isSessionExpired flips at the 90-day boundary', () => {
  assert.equal(isSessionExpired(dbTime(89), NOW), false);
  assert.equal(isSessionExpired(dbTime(91), NOW), true);
  assert.equal(isSessionExpired(null, NOW), false, 'unparseable dates are not treated as expired');
  assert.equal(HISTORY_RETENTION_DAYS, 90);
});

await test('hasActiveVoicePlan: unlimited or usable pack credits; hasEverPaid alone is not a plan', () => {
  assert.equal(hasActiveVoicePlan(SUB_ENT), true);
  assert.equal(hasActiveVoicePlan(PACK_ENT), true);
  assert.equal(hasActiveVoicePlan(FREE_ENT), false);
  assert.equal(hasActiveVoicePlan(LAPSED_PAID_ENT), false);
});

await test('sessionFullAccess mirrors the session GET gate', () => {
  assert.equal(sessionFullAccess({ entitlement_mode: 'pack' }, FREE_ENT), true, 'paid session is always unlocked');
  assert.equal(sessionFullAccess({ entitlement_mode: 'free' }, FREE_ENT), false);
  assert.equal(sessionFullAccess({ entitlement_mode: 'free' }, SUB_ENT), true);
  assert.equal(sessionFullAccess({ entitlement_mode: 'free' }, LAPSED_PAID_ENT), true, 'hasEverPaid keeps the free session unlocked');
});

await test("a safety-ended session reports status 'safety', never a perpetual 'scoring'", async () => {
  const state = { sessions: [
    // Legacy row: mis-scored BEFORE suppression existed — the stored numbers
    // must not surface anywhere
    sessionRow({ user_id: 1, entitlement_mode: 'subscription', scorecard_json: JSON.stringify({ overall: 61, topImprovement: 'Stay professional under pressure' }), end_reason: 'ended_for_safety' }),
    sessionRow({ user_id: 1, entitlement_mode: 'subscription', scorecard_json: null, end_reason: null }),
    sessionRow({ user_id: 1, entitlement_mode: 'subscription', end_reason: 'user_ended' })
  ] };
  const sessions = await listVoiceSessions(makeEnv(state), 1, SUB_ENT, NOW);
  const byId = Object.fromEntries(sessions.map((x) => [x.sessionId, x]));
  const safety = byId[state.sessions[0].id];
  // Safety row: its report is deliberately never generated
  assert.equal(safety.status, 'safety');
  assert.equal(safety.endReason, 'ended_for_safety');
  // Even a legacy stored scorecard never leaks a score or coaching line
  assert.equal(safety.overall, null);
  assert.equal(safety.topImprovement, null);
  // A genuinely still-scoring row keeps reporting scoring
  assert.equal(byId[state.sessions[1].id].status, 'scoring');
  // A normally scored row is untouched
  assert.equal(byId[state.sessions[2].id].status, 'ready');
});

await test('list returns at most 10 newest sessions with ownership enforced', async () => {
  const state = { sessions: [] };
  for (let i = 0; i < 14; i++) {
    state.sessions.push(sessionRow({ user_id: 1, started_at: dbTime(i + 1), entitlement_mode: 'subscription' }));
  }
  state.sessions.push(sessionRow({ user_id: 2, started_at: dbTime(0.5), entitlement_mode: 'subscription' }));

  const sessions = await listVoiceSessions(makeEnv(state), 1, SUB_ENT, NOW);
  assert.equal(sessions.length, HISTORY_LIMIT);
  assert.ok(sessions.every((s) => s.sessionId.startsWith('s-')));
  assert.ok(!sessions.some((s) => state.sessions.find((r) => r.id === s.sessionId)?.user_id === 2),
    'another user\'s session must never be listed');
  // Newest first
  const t = sessions.map((s) => parseDbTime(s.createdAt));
  for (let i = 1; i < t.length; i++) assert.ok(t[i - 1] >= t[i], 'ordered newest first');
});

await test('incomplete sessions (created/active/abandoned) are not listed', async () => {
  const state = { sessions: [
    sessionRow({ status: 'completed' }),
    sessionRow({ status: 'created' }),
    sessionRow({ status: 'active' }),
    sessionRow({ status: 'abandoned' })
  ] };
  const sessions = await listVoiceSessions(makeEnv(state), 1, FREE_ENT, NOW);
  assert.equal(sessions.length, 1);
});

await test('free user\'s aged session stays listed with reportAvailable:false (retention carve-out)', async () => {
  const state = { sessions: [sessionRow({ entitlement_mode: 'free', started_at: dbTime(120) })] };
  const sessions = await listVoiceSessions(makeEnv(state), 1, FREE_ENT, NOW);
  assert.equal(sessions.length, 1, 'the single free-taste row survives the 90-day lapse');
  assert.equal(sessions[0].reportAvailable, false);
  assert.equal(sessions[0].overall, null, 'no score leaks on a locked free row');
  assert.equal(sessions[0].role, 'Data Engineer', 'row metadata remains');
});

await test('lapsed-paid user (no active plan) also keeps only the most recent aged row', async () => {
  const state = { sessions: [
    sessionRow({ entitlement_mode: 'pack', started_at: dbTime(100) }),
    sessionRow({ entitlement_mode: 'pack', started_at: dbTime(150) })
  ] };
  const sessions = await listVoiceSessions(makeEnv(state), 1, LAPSED_PAID_ENT, NOW);
  assert.equal(sessions.length, 1, 'only the most recent row is carved out');
  assert.equal(sessions[0].reportAvailable, false);
  assert.equal(sessions[0].overall, null,
    'a locked expired row must not leak its score, even with fullAccess and an unstripped scorecard');
});

await test('paid user\'s aged sessions are excluded from the list (typed rule)', async () => {
  const state = { sessions: [
    sessionRow({ entitlement_mode: 'subscription', started_at: dbTime(120) }),
    sessionRow({ entitlement_mode: 'subscription', started_at: dbTime(5) })
  ] };
  const sessions = await listVoiceSessions(makeEnv(state), 1, SUB_ENT, NOW);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].reportAvailable, true);
  assert.equal(isSessionExpired(sessions[0].createdAt, NOW), false, 'only the recent session remains');
});

await test('overall appears only with full access and a ready scorecard', async () => {
  const state = { sessions: [
    sessionRow({ entitlement_mode: 'free', scorecard_json: JSON.stringify({ overall: 71 }) }),
    sessionRow({ entitlement_mode: 'free', scorecard_json: null, started_at: dbTime(2) })
  ] };

  // Free user: scored row shows no overall (partial), unscored row is 'scoring'
  const freeList = await listVoiceSessions(makeEnv(state), 1, FREE_ENT, NOW);
  assert.equal(freeList[0].overall, null);
  assert.equal(freeList[0].fullAccess, false);
  assert.equal(freeList[0].status, 'ready');
  assert.equal(freeList[1].status, 'scoring');
  assert.equal(freeList[1].overall, null);

  // Entitled user: same free-taste session unlocks retroactively
  const paidList = await listVoiceSessions(makeEnv(state), 1, SUB_ENT, NOW);
  assert.equal(paidList[0].overall, 71);
  assert.equal(paidList[0].fullAccess, true);
});

await test('delete enforces ownership', async () => {
  const state = { sessions: [
    sessionRow({ id: 'mine', user_id: 1 }),
    sessionRow({ id: 'theirs', user_id: 2 })
  ] };
  const env = makeEnv(state);

  assert.equal(await deleteVoiceSession(env, 1, 'theirs'), false, 'cannot delete another user\'s session');
  assert.equal(state.sessions.length, 2);
  assert.equal(await deleteVoiceSession(env, 1, 'mine'), true);
  assert.equal(state.sessions.length, 1);
  assert.equal(await deleteVoiceSession(env, 1, 'mine'), false, 'second delete is a miss');
});

await test('clear removes only the caller\'s sessions', async () => {
  const state = { sessions: [
    sessionRow({ user_id: 1 }),
    sessionRow({ user_id: 1 }),
    sessionRow({ user_id: 2 })
  ] };
  const env = makeEnv(state);

  assert.equal(await clearVoiceSessions(env, 1), 2);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].user_id, 2, 'other users\' history is untouched');
  assert.equal(await clearVoiceSessions(env, 1), 0, 'clearing again is a no-op');
});

await test('delete refuses in-flight (created/active) sessions', async () => {
  const state = { sessions: [
    sessionRow({ id: 'live-2', user_id: 1, status: 'active' }),
    sessionRow({ id: 'fresh-2', user_id: 1, status: 'created' }),
    sessionRow({ id: 'done-2', user_id: 1, status: 'completed' })
  ] };
  const env = makeEnv(state);

  assert.equal(await deleteVoiceSession(env, 1, 'live-2'), false, 'active session must survive');
  assert.equal(await deleteVoiceSession(env, 1, 'fresh-2'), false, 'created session must survive');
  assert.equal(state.sessions.length, 3);
  assert.equal(await deleteVoiceSession(env, 1, 'done-2'), true, 'completed sessions delete normally');
  assert.equal(state.sessions.length, 2);
});

await test('clear never deletes an in-flight (created/active) session', async () => {
  const state = { sessions: [
    sessionRow({ id: 'done-1', user_id: 1, status: 'completed' }),
    sessionRow({ id: 'gone-1', user_id: 1, status: 'abandoned' }),
    sessionRow({ id: 'live-1', user_id: 1, status: 'active' }),
    sessionRow({ id: 'fresh-1', user_id: 1, status: 'created' })
  ] };
  const env = makeEnv(state);

  assert.equal(await clearVoiceSessions(env, 1), 2, 'completed + abandoned rows cleared');
  const remaining = state.sessions.map((s) => s.id).sort();
  assert.deepEqual(remaining, ['fresh-1', 'live-1'],
    'the live session row must survive so /complete can still save the interview');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
