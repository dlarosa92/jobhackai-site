import test from 'node:test';
import assert from 'node:assert/strict';
import { getVoicePlanSummary } from '../voice-plan-summary.js';

const row = { id: 'fixture', plan: 'free', voice_sessions_remaining: 4,
  pack_expires_at: '2099-12-31', free_session_used: 1, has_ever_paid: 1 };
const database = value => ({ prepare(sql) {
  assert.ok(sql.includes('FROM users'), 'paused mode must not require managed transport tables');
  return { bind() { return this; }, first: async () => value };
} });

test('a paused voice feature still reports owned pack credits with starts disabled', async () => {
  for (const flag of [undefined, 'false']) {
    const summary = await getVoicePlanSummary({ DB: database(row), VOICE_INTERVIEW_ENABLED: flag, VOICE_MANAGED_CALLS_ENABLED: 'true' }, 'fixture');
    assert.equal(summary.lookupStatus, 'ready');
    assert.equal(summary.mode, 'pack');
    assert.equal(summary.sessionsRemaining, 4);
    assert.equal(summary.packExpiresAt, '2099-12-31');
    assert.equal(summary.enabled, false);
    assert.equal(summary.canStart, false);
  }
});

test('a free account remains distinguishable from an unavailable backend during a pause', async () => {
  const summary = await getVoicePlanSummary({ DB: database({ ...row, voice_sessions_remaining: 0, free_session_used: 0 }) }, 'fixture');
  assert.equal(summary.lookupStatus, 'ready');
  assert.equal(summary.mode, 'free');
  assert.equal(summary.canStart, false);
  for (const DB of [null, { prepare() { throw Error('connection failed'); } }]) {
    const unavailable = await getVoicePlanSummary({ DB }, 'fixture');
    assert.equal(unavailable.lookupStatus, 'unavailable');
    assert.equal(unavailable.enabled, false);
    assert.equal(unavailable.canStart, false);
  }
});

test('enabled voice preserves the normal authoritative pack entitlement', async () => {
  const summary = await getVoicePlanSummary({ DB: database(row), VOICE_INTERVIEW_ENABLED: 'true' }, 'fixture');
  assert.equal(summary.lookupStatus, 'ready');
  assert.equal(summary.mode, 'pack');
  assert.equal(summary.enabled, true);
  assert.equal(summary.canStart, true);
});
