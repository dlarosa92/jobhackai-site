// GET /api/voice/session/:id report gating.
// Run: node --test app/functions/_lib/__tests__/voice-session-report.test.mjs
//
// The route runs for real in a vm context with its imports replaced by the
// real scorecard and history helpers, a fixed entitlement, and a one-row D1
// stub, so the payload the client renders from is the one that ships.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  partialScorecard, groundedMoments, groundedCompetencies, scoreVoiceTranscript,
  interviewerQuestionCount, FREE_REPORT_SHOWS_SCORE
} from '../voice-scorecard.js';
import { isSessionExpired, hasActiveVoicePlan } from '../voice-history.js';
import { voiceRetryEnabled, retryEligibility } from '../voice-retry.js';

const route = readFileSync(new URL('../../api/voice/session/[id].js', import.meta.url), 'utf8');

const FREE_USED = { canStart: false, mode: null, reason: 'paywall', unlimited: false, sessionsRemaining: 0, hasEverPaid: false };
const LAPSED = { ...FREE_USED, hasEverPaid: true };
const SUBSCRIBER = { canStart: true, mode: 'subscription', reason: null, unlimited: true, sessionsRemaining: 0, hasEverPaid: true };
const LIMIT_REACHED = { ...SUBSCRIBER, canStart: false, reason: 'limit_reached' };
const PACK = { canStart: true, mode: 'pack', reason: null, unlimited: false, sessionsRemaining: 3, hasEverPaid: true };

const TRANSCRIPT = [
  { speaker: 'assistant', text: 'Welcome. Tell me about a time you challenged a decision?' },
  { speaker: 'user', text: 'I challenged it. We talked and it was fine in the end.' },
  { speaker: 'assistant', text: 'What did you change as a result?' },
  { speaker: 'user', text: 'I rewrote the rollout plan with the team, moved the launch by one week, and we shipped with no incidents.' },
  { speaker: 'assistant', text: 'Thank you for your time. Your feedback report is being prepared.' }
];

const SCORED = {
  methodologyVersion: 2, overall: 72, topStrength: 'Clear example.', topImprovement: 'Lead with the result.',
  dimensions: { communication: 74, structure: 66, contentDepth: 71, roleFit: 78 },
  moments: [
    { quote: 'Something the candidate never said.', comment: 'Invented.' },
    { quote: 'I challenged it.', comment: 'Say what you did instead.' }
  ],
  competencies: [{ name: 'Influence', status: 'needs_practice', quote: 'I challenged it.', feedback: 'No specifics.' }],
  summary: 'Solid.'
};

// The fixed card production stores for a session too short to score.
const { scorecard: TOO_SHORT } = await scoreVoiceTranscript(
  { role: 'Product Manager', transcript: [{ speaker: 'user', text: 'Hello?' }] }, {});

function dbTime(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function sessionRow(overrides = {}) {
  return {
    id: 'sess-1', user_id: 1, role: 'Product Manager', seniority: 'Senior', status: 'completed',
    entitlement_mode: 'free', started_at: dbTime(3), ended_at: dbTime(3), duration_seconds: 45,
    transcript_json: JSON.stringify(TRANSCRIPT),
    scorecard_json: JSON.stringify(SCORED), end_reason: 'user_ended', ...overrides
  };
}

async function getReport(row, ent, { env = {}, retryClaimed = async () => false } = {}) {
  const db = { prepare: () => ({ bind: () => ({ first: async () => row }) }) };
  const ctx = {
    Request, Response, console: { log() {}, warn() {}, error() {} },
    getBearer: () => 'token', verifyFirebaseIdToken: async () => ({ uid: 'owner' }),
    getOrCreateUserByAuthId: async () => ({ id: 1 }), getDb: () => db,
    getVoiceEntitlement: async () => ent, voiceFeatureEnabled: () => true,
    partialScorecard, groundedMoments, groundedCompetencies, interviewerQuestionCount,
    voiceRetryEnabled, retryEligibility, retryClaimed,
    isSessionExpired, hasActiveVoicePlan, deleteVoiceSession: async () => false,
    generateRequestId: () => 'req', successResponse: (body, status) => Response.json(body, { status }),
    errorResponse: (error, status) => Response.json({ error }, { status })
  };
  vm.createContext(ctx);
  vm.runInContext(route.replace(/^import .*;\n/gm, '')
    .replace('export async function onRequest', 'async function onRequest') + '\nglobalThis.handler = onRequest', ctx);
  const res = await ctx.handler({
    env, params: { id: row.id },
    request: new Request('https://app.jobhackai.io/api/voice/session/' + row.id, { headers: { Authorization: 'Bearer token' } })
  });
  return { status: res.status, body: await res.json() };
}

test('partialScorecard keeps tooShort and still withholds the full report', () => {
  assert.equal(TOO_SHORT.tooShort, true, 'fixture is the production too-short card');
  const partial = partialScorecard(TOO_SHORT);
  assert.equal(partial.tooShort, true);
  assert.equal(partial.partial, true);
  assert.equal(partial.topStrength, TOO_SHORT.topStrength);
  for (const key of ['overall', 'dimensions', 'moments', 'summary']) assert.equal(partial[key], null, key);
  assert.ok(!('tooShort' in partialScorecard(SCORED)), 'a scored session carries no tooShort flag');
  assert.equal(partialScorecard(null), null);
});

test('a free session too short to score reaches the client flagged as too short', async () => {
  const { status, body } = await getReport(sessionRow({ scorecard_json: JSON.stringify(TOO_SHORT) }), FREE_USED);
  assert.equal(status, 200);
  assert.equal(body.fullAccess, false);
  assert.equal(body.scorecard.tooShort, true);
  assert.equal(body.scorecard.partial, true);
  assert.equal(body.transcript, null, 'the free view never gets the transcript');
});

test('the free report shows the server score and nothing else of the full report', async () => {
  assert.equal(FREE_REPORT_SHOWS_SCORE, true, 'the free score flag defaults to on');
  const { body } = await getReport(sessionRow(), FREE_USED);
  assert.equal(body.fullAccess, false);
  assert.equal(body.scorecard.overall, 72);
  assert.equal(body.scorecard.methodologyVersion, 2);
  for (const key of ['dimensions', 'moments', 'summary']) assert.equal(body.scorecard[key], null, key);
  assert.ok(!('competencies' in body.scorecard));
  assert.equal(body.transcript, null);
  assert.ok(!JSON.stringify(body).includes('rewrote the rollout plan'), 'no transcript text leaks');
  assert.ok(!('tooShort' in body.scorecard));
});

test('feedback-only stored reports cannot leak numeric fields through paid or free report access', async () => {
  for (const ent of [FREE_USED, PACK]) {
    const { body } = await getReport(sessionRow({ scorecard_json: JSON.stringify({ ...SCORED, feedbackOnly: true }) }), ent);
    assert.equal(body.scorecard.feedbackOnly, true);
    assert.equal(body.scorecard.overall, null);
    assert.equal(body.scorecard.dimensions, null);
    assert.ok(body.scorecard.saoBalance == null);
    assert.equal(body.scorecard.topImprovement, SCORED.topImprovement);
  }
});

test('the free teaser quotes only a grounded moment, never feedback', async () => {
  const { body } = await getReport(sessionRow(), FREE_USED);
  assert.equal(body.scorecard.teaserQuote, 'I challenged it.', 'the invented quote is skipped');
  assert.ok(!JSON.stringify(body.scorecard).includes('Say what you did instead.'));
  const noGrounded = { ...SCORED, moments: [{ quote: 'Never said.', comment: 'x' }] };
  const { body: none } = await getReport(sessionRow({ scorecard_json: JSON.stringify(noGrounded) }), FREE_USED);
  assert.ok(!('teaserQuote' in none.scorecard));
});

test('a too-short free session gets no score', async () => {
  const { body } = await getReport(sessionRow({ scorecard_json: JSON.stringify(TOO_SHORT) }), FREE_USED);
  assert.equal(body.scorecard.overall, null);
  assert.ok(!('teaserQuote' in body.scorecard));
});

test('the report counts the questions the interviewer asked', async () => {
  const { body } = await getReport(sessionRow(), FREE_USED);
  assert.equal(body.questionCount, 2, 'the closing statement is not a question');
  assert.equal(interviewerQuestionCount(null), 0);
});

test('the retry offer stays off by default', async () => {
  const { body } = await getReport(sessionRow(), FREE_USED);
  assert.ok(!('retry' in body));
});

test('with the retry flag on, an eligible free report offers the weakest question', async () => {
  const env = { VOICE_RETRY_ENABLED: 'true' };
  const { body } = await getReport(sessionRow(), FREE_USED, { env });
  assert.deepEqual(body.retry, { eligible: true, question: 'Welcome. Tell me about a time you challenged a decision?' });
  const claimed = await getReport(sessionRow(), FREE_USED, { env, retryClaimed: async () => true });
  assert.ok(!('retry' in claimed.body), 'one retry per session');
  const paid = await getReport(sessionRow(), SUBSCRIBER, { env });
  assert.ok(!('retry' in paid.body), 'full access has no retry offer');
});

test('a missing retry table hides the offer instead of failing the report', async () => {
  const { status, body } = await getReport(sessionRow(), FREE_USED, {
    env: { VOICE_RETRY_ENABLED: 'true' },
    retryClaimed: async () => { throw new Error('no such table: voice_question_retries'); }
  });
  assert.equal(status, 200);
  assert.ok(!('retry' in body));
  assert.equal(body.scorecard.overall, 72);
});

for (const [label, ent, activePlan] of [
  ['an active subscriber', SUBSCRIBER, true],
  ['a subscriber at the monthly limit', LIMIT_REACHED, true],
  ['a pack with credits left', PACK, true],
  ['a lapsed paid user', LAPSED, false],
  ['a free user', FREE_USED, false]
]) {
  test(`an expired report tells the client whether ${label} has an active plan`, async () => {
    const { status, body } = await getReport(sessionRow({ entitlement_mode: 'subscription', started_at: dbTime(120) }), ent);
    assert.equal(status, 200);
    assert.equal(body.expired, true);
    assert.equal(body.activePlan, activePlan);
    assert.equal(body.fullAccess, false, 'retention locks the report for every plan');
    assert.equal(body.transcript, null);
    assert.deepEqual(Object.keys(body.scorecard).sort(), ['topImprovement', 'topStrength']);
  });
}
