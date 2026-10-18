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
import { partialScorecard, groundedMoments, groundedCompetencies, scoreVoiceTranscript } from '../voice-scorecard.js';
import { isSessionExpired, hasActiveVoicePlan } from '../voice-history.js';

const route = readFileSync(new URL('../../api/voice/session/[id].js', import.meta.url), 'utf8');

const FREE_USED = { canStart: false, mode: null, reason: 'paywall', unlimited: false, sessionsRemaining: 0, hasEverPaid: false };
const LAPSED = { ...FREE_USED, hasEverPaid: true };
const SUBSCRIBER = { canStart: true, mode: 'subscription', reason: null, unlimited: true, sessionsRemaining: 0, hasEverPaid: true };
const LIMIT_REACHED = { ...SUBSCRIBER, canStart: false, reason: 'limit_reached' };
const PACK = { canStart: true, mode: 'pack', reason: null, unlimited: false, sessionsRemaining: 3, hasEverPaid: true };

const SCORED = {
  methodologyVersion: 2, overall: 72, topStrength: 'Clear example.', topImprovement: 'Lead with the result.',
  dimensions: { communication: 74, structure: 66, contentDepth: 71, roleFit: 78 }, moments: [], summary: 'Solid.'
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
    transcript_json: JSON.stringify([{ speaker: 'user', text: 'Hello?' }]),
    scorecard_json: JSON.stringify(SCORED), end_reason: 'user_ended', ...overrides
  };
}

async function getReport(row, ent) {
  const db = { prepare: () => ({ bind: () => ({ first: async () => row }) }) };
  const ctx = {
    Request, Response, console: { log() {}, warn() {}, error() {} },
    getBearer: () => 'token', verifyFirebaseIdToken: async () => ({ uid: 'owner' }),
    getOrCreateUserByAuthId: async () => ({ id: 1 }), getDb: () => db,
    getVoiceEntitlement: async () => ent, voiceFeatureEnabled: () => true,
    partialScorecard, groundedMoments, groundedCompetencies,
    isSessionExpired, hasActiveVoicePlan, deleteVoiceSession: async () => false,
    generateRequestId: () => 'req', successResponse: (body, status) => Response.json(body, { status }),
    errorResponse: (error, status) => Response.json({ error }, { status })
  };
  vm.createContext(ctx);
  vm.runInContext(route.replace(/^import .*;\n/gm, '')
    .replace('export async function onRequest', 'async function onRequest') + '\nglobalThis.handler = onRequest', ctx);
  const res = await ctx.handler({
    env: {}, params: { id: row.id },
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

test('a free scored session stays a plain partial report', async () => {
  const { body } = await getReport(sessionRow(), FREE_USED);
  assert.equal(body.fullAccess, false);
  assert.equal(body.scorecard.overall, null);
  assert.ok(!('tooShort' in body.scorecard));
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
