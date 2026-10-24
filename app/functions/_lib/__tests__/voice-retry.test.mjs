// "Retry this question, free": server-side allowance.
// Run: node --test app/functions/_lib/__tests__/voice-retry.test.mjs
//
// The retry voice session is not built yet (VOICE_RETRY_ENABLED stays off);
// these pin the question choice, eligibility, and the one-per-session claim.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import {
  weakestQuestion, retryEligibility, claimRetry, retryClaimed, voiceRetryEnabled, VOICE_RETRY_MINUTES
} from '../voice-retry.js';

const Q1 = 'Tell me about a time you challenged a decision?';
const Q2 = 'How did you measure the result?';
const TRANSCRIPT = [
  { speaker: 'assistant', text: 'Welcome to the interview. ' + Q1 },
  { speaker: 'user', text: 'I challenged it and we moved on.' },
  { speaker: 'assistant', text: Q2 },
  { speaker: 'user', text: 'We tracked weekly support tickets for a quarter, and they fell from about forty to twelve after the change.' },
  { speaker: 'assistant', text: 'Thank you. Your feedback report is being prepared.' }
];
const SCORED = { overall: 58, methodologyVersion: 2, topImprovement: 'Give specifics.', competencies: [] };

test('the retry is a short session and stays off unless enabled', () => {
  assert.equal(VOICE_RETRY_MINUTES, 3);
  assert.equal(voiceRetryEnabled({}), false);
  assert.equal(voiceRetryEnabled({ VOICE_RETRY_ENABLED: 'false' }), false);
  assert.equal(voiceRetryEnabled({ VOICE_RETRY_ENABLED: 'true' }), true);
});

test('the question behind a needs-practice competency is the one to retry', () => {
  const scorecard = { ...SCORED, competencies: [
    { name: 'Measurement', status: 'demonstrated', quote: 'they fell from about forty to twelve', feedback: '' },
    { name: 'Influence', status: 'needs_practice', quote: 'I challenged it', feedback: '' }
  ] };
  assert.equal(weakestQuestion(scorecard, TRANSCRIPT), 'Welcome to the interview. ' + Q1);
});

test('without a grounded weak competency, the question with the shortest answer is chosen', () => {
  const invented = { ...SCORED, competencies: [{ name: 'X', status: 'needs_practice', quote: 'words never spoken', feedback: '' }] };
  assert.equal(weakestQuestion(invented, TRANSCRIPT), 'Welcome to the interview. ' + Q1);
  const longFirst = [TRANSCRIPT[0], { speaker: 'user', text: TRANSCRIPT[3].text }, TRANSCRIPT[2], { speaker: 'user', text: 'Not sure.' }];
  assert.equal(weakestQuestion(SCORED, longFirst), Q2);
});

test('only interviewer questions that were answered can be retried', () => {
  assert.equal(weakestQuestion(SCORED, [{ speaker: 'assistant', text: Q1 }]), null, 'an unanswered question');
  assert.equal(weakestQuestion(SCORED, [{ speaker: 'assistant', text: 'Thanks.' }, { speaker: 'user', text: 'Sure.' }]), null, 'no question asked');
  assert.equal(weakestQuestion(SCORED, null), null);
  // Session controls are not answers.
  const control = [{ speaker: 'assistant', text: Q1 }, { speaker: 'user', text: 'Can you hear me?' }];
  assert.equal(weakestQuestion(SCORED, control), null);
});

test('eligibility covers the flag, the plan, scoring, expiry, and a prior claim', () => {
  const session = { entitlement_mode: 'free', status: 'completed', end_reason: 'user_ended' };
  const base = { enabled: true, session, scorecard: SCORED, transcript: TRANSCRIPT, alreadyClaimed: false, expired: false };
  assert.deepEqual(retryEligibility(base), { eligible: true, reason: null, question: 'Welcome to the interview. ' + Q1 });
  for (const [reason, change] of [
    ['disabled', { enabled: false }],
    ['not_free', { session: { ...session, entitlement_mode: 'pack' } }],
    ['not_completed', { session: { ...session, status: 'active' } }],
    ['not_completed', { session: { ...session, end_reason: 'ended_for_safety' } }],
    ['expired', { expired: true }],
    ['not_scored', { scorecard: { ...SCORED, tooShort: true } }],
    ['not_scored', { scorecard: { ...SCORED, overall: null } }],
    ['already_retried', { alreadyClaimed: true }],
    ['no_question', { transcript: [] }]
  ]) {
    assert.equal(retryEligibility({ ...base, ...change }).reason, reason, reason);
  }
});

function setup(t) {
  const db = sqliteD1();
  t.after(() => db.close());
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, auth_id TEXT); INSERT INTO users VALUES (1,'owner'),(2,'other');");
  for (const name of ['020_add_voice_entitlements.sql', '021_add_voice_end_reason.sql', '034_voice_question_retries.sql']) {
    db.exec(readFileSync(new URL('../../../db/migrations/' + name, import.meta.url), 'utf8'));
  }
  const add = (id, { user = 1, mode = 'free', status = 'completed', reason = 'user_ended', scorecard = SCORED } = {}) =>
    db.prepare(`INSERT INTO voice_sessions(id,user_id,status,entitlement_mode,end_reason,scorecard_json) VALUES (?,?,?,?,?,?)`)
      .bind(id, user, status, mode, reason, scorecard ? JSON.stringify(scorecard) : null).run();
  return { db, env: { DB: db }, add };
}

test('a scored free session can be claimed exactly once, by its owner', async t => {
  const h = setup(t);
  await h.add('s1');
  assert.equal(await retryClaimed(h.env, 's1'), false);
  assert.equal(await claimRetry(h.env, { userRowId: 2, parentSessionId: 's1' }), false, 'not the owner');
  assert.equal(await claimRetry(h.env, { userRowId: 1, parentSessionId: 's1' }), true);
  assert.equal(await claimRetry(h.env, { userRowId: 1, parentSessionId: 's1' }), false, 'second claim');
  assert.equal(await retryClaimed(h.env, 's1'), true);
});

test('unscored, too-short, paid, unfinished and safety sessions cannot be claimed', async t => {
  const h = setup(t);
  await h.add('none', { scorecard: null });
  await h.add('short', { scorecard: { tooShort: true, overall: null } });
  await h.add('pack', { mode: 'pack' });
  await h.add('live', { status: 'active' });
  await h.add('safety', { reason: 'ended_for_safety' });
  for (const id of ['none', 'short', 'pack', 'live', 'safety']) {
    assert.equal(await claimRetry(h.env, { userRowId: 1, parentSessionId: id }), false, id);
  }
});

test('deleting the parent session removes its claim', async t => {
  const h = setup(t);
  await h.add('s1');
  await claimRetry(h.env, { userRowId: 1, parentSessionId: 's1' });
  await h.db.prepare("DELETE FROM voice_sessions WHERE id='s1'").run();
  assert.equal(await retryClaimed(h.env, 's1'), false);
});
