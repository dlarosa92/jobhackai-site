// Interview summary PDF: who can export, and proof that exporting is free.
// Run: node --test app/functions/_lib/__tests__/voice-summary-access.test.mjs
//
// The summary adds no entitlement of its own. It is built from the payload
// of GET /api/voice/session/:id, so this suite runs that route for real (in
// a vm context, like voice-session-report.test.mjs) with the REAL user
// lookup and the REAL getVoiceEntitlement over a real SQLite database built
// from db/schema.sql. Each account below is a row shaped the way that kind
// of account exists in production.
//
// Manual pilot grants: there is no pilot plan. A manually granted account is
// an ordinary free-plan row whose voice_sessions_remaining was set by hand,
// with no subscription, no expiry, has_ever_paid = 0, and often a blank
// email. The fixtures reproduce exactly that, at two different balances.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { getOrCreateUserByAuthId, getDb } from '../db.js';
import { getVoiceEntitlement, reserveVoiceSession, voiceFeatureEnabled } from '../voice-entitlements.js';
import { partialScorecard, groundedMoments, groundedCompetencies, interviewerQuestionCount, scoreVoiceTranscript } from '../voice-scorecard.js';
import { voiceRetryEnabled, retryEligibility, retryClaimed } from '../voice-retry.js';
import { isSessionExpired, hasActiveVoicePlan, deleteVoiceSession, listVoiceSessions } from '../voice-history.js';
import { buildInterviewSummary, renderSummaryPdf } from '../../../../js/voice-summary-pdf.js';
import { loadPdfDeps, readPdf } from './helpers/pdf-test-kit.mjs';

const route = readFileSync(new URL('../../api/voice/session/[id].js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');

const db = sqliteD1();
after(() => db.close());
db.exec(schema);
const env = { DB: db, VOICE_INTERVIEW_ENABLED: 'true', FIREBASE_PROJECT_ID: 'test' };

const dbTime = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 19).replace('T', ' ');
const isoIn = (days) => new Date(Date.now() + days * 86400000).toISOString();

const TRANSCRIPT = [
  { speaker: 'assistant', text: 'Tell me about a time you helped an upset customer?' },
  { speaker: 'user', text: 'I let her finish before I said anything, then I reshipped the order the same day.' },
  { speaker: 'assistant', text: 'Thank you for your time. Your feedback report is being prepared.' }
];
const SCORED = {
  methodologyVersion: 2, overall: 72, topStrength: 'You stayed calm and specific.', topImprovement: 'Finish with the outcome.',
  assessmentScope: 'Based on one customer example.',
  dimensions: { communication: 74, structure: 66, contentDepth: 71, roleFit: 78 },
  saoBalance: { situation: 40, action: 45, outcome: 15 },
  saoCoaching: ['Name the result first.', 'Practice out loud once.'],
  competencies: [{ name: 'Customer empathy', status: 'demonstrated', quote: 'I let her finish before I said anything', feedback: 'You listened first.' }],
  moments: [{ quote: 'I let her finish before I said anything', comment: 'Good listening.' }],
  summary: 'Clear and honest.'
};
const { scorecard: TOO_SHORT } = await scoreVoiceTranscript({ role: 'PM', transcript: [{ speaker: 'user', text: 'Hello?' }] }, {});

let nextUserId = 1;
async function addUser(authId, fields = {}) {
  const row = { plan: 'free', email: authId + '@example.test', subscription_status: null, current_period_end: null,
    voice_sessions_remaining: 0, free_session_used: 0, pack_expires_at: null, has_ever_paid: 0, ...fields };
  const id = nextUserId++;
  await db.prepare(`INSERT INTO users (id, auth_id, email, plan, subscription_status, current_period_end,
      voice_sessions_remaining, free_session_used, pack_expires_at, has_ever_paid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, authId, row.email, row.plan, row.subscription_status,
    row.current_period_end, row.voice_sessions_remaining, row.free_session_used, row.pack_expires_at, row.has_ever_paid).run();
  return id;
}

async function addSession(id, userId, fields = {}) {
  const row = { role: 'Customer Service Representative', seniority: 'Entry level', status: 'completed', entitlement_mode: 'pack',
    started_at: dbTime(2), ended_at: dbTime(2), duration_seconds: 600, end_reason: 'user_ended',
    transcript_json: JSON.stringify(TRANSCRIPT), scorecard_json: JSON.stringify(SCORED), ...fields };
  await db.prepare(`INSERT INTO voice_sessions (id, user_id, role, seniority, status, entitlement_mode, started_at, ended_at,
      duration_seconds, end_reason, transcript_json, scorecard_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, userId, row.role, row.seniority, row.status, row.entitlement_mode, row.started_at, row.ended_at,
      row.duration_seconds, row.end_reason, row.transcript_json, row.scorecard_json).run();
}

// Every stored field of the account and of all its sessions, for before/after
// comparison. If an export wrote anything at all, these differ.
async function snapshot(userId) {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  const sessions = (await db.prepare('SELECT * FROM voice_sessions WHERE user_id = ? ORDER BY id').bind(userId).all()).results;
  const total = await db.prepare('SELECT COUNT(*) AS n FROM voice_sessions').first();
  return JSON.stringify({ user, sessions, totalSessions: total.n });
}

async function request(uid, sessionId, method = 'GET') {
  const ctx = {
    Request, Response, console: { log() {}, warn() {}, error() {} },
    getBearer: () => 'token', verifyFirebaseIdToken: async () => ({ uid }),
    getOrCreateUserByAuthId, getDb, getVoiceEntitlement, voiceFeatureEnabled,
    partialScorecard, groundedMoments, groundedCompetencies, interviewerQuestionCount,
    voiceRetryEnabled, retryEligibility, retryClaimed,
    isSessionExpired, hasActiveVoicePlan, deleteVoiceSession,
    generateRequestId: () => 'req', successResponse: (body, status) => Response.json(body, { status }),
    errorResponse: (error, status) => Response.json({ error }, { status })
  };
  vm.createContext(ctx);
  vm.runInContext(route.replace(/^import .*;\n/gm, '')
    .replace('export async function onRequest', 'async function onRequest') + '\nglobalThis.handler = onRequest', ctx);
  const res = await ctx.handler({
    env, params: { id: sessionId },
    request: new Request('https://app.jobhackai.io/api/voice/session/' + sessionId, { method, headers: { Authorization: 'Bearer token' } })
  });
  return { status: res.status, body: await res.json() };
}

// View the report and export it `times` times; return the summaries.
async function exportTimes(uid, sessionId, times) {
  const out = [];
  for (let i = 0; i < times; i++) {
    const { status, body } = await request(uid, sessionId);
    assert.equal(status, 200);
    const summary = buildInterviewSummary(body);
    if (summary.available) await renderSummaryPdf(summary, loadPdfDeps());
    out.push(summary);
  }
  return out;
}

// ------------------------------------------------------------ accounts

const ids = {};
ids.freeUsed = await addUser('uid-free-used', { free_session_used: 1 });
ids.pack = await addUser('uid-pack', { plan: 'pack', voice_sessions_remaining: 3, pack_expires_at: isoIn(60), has_ever_paid: 1, free_session_used: 1 });
ids.subscriber = await addUser('uid-subscriber', { plan: 'monthly', subscription_status: 'active', current_period_end: isoIn(20), has_ever_paid: 1, free_session_used: 1 });
ids.lapsed = await addUser('uid-lapsed', { plan: 'free', subscription_status: 'canceled', has_ever_paid: 1, free_session_used: 1 });
// Manual pilot grants, as they exist in production: free plan, no
// subscription, no expiry, never paid.
ids.grant60 = await addUser('uid-grant-60', { voice_sessions_remaining: 60 });
ids.grant7 = await addUser('uid-grant-7', { voice_sessions_remaining: 7 });
ids.grantBlankEmail = await addUser('uid-grant-blank-email', { voice_sessions_remaining: 12, email: null });
ids.grantSpent = await addUser('uid-grant-spent', { voice_sessions_remaining: 0, free_session_used: 0 });
ids.stranger = await addUser('uid-stranger', { plan: 'monthly', subscription_status: 'active', current_period_end: isoIn(20), has_ever_paid: 1 });

await addSession('s-free', ids.freeUsed, { entitlement_mode: 'free' });
await addSession('s-pack', ids.pack, { entitlement_mode: 'pack' });
await addSession('s-sub', ids.subscriber, { entitlement_mode: 'subscription' });
await addSession('s-lapsed-free', ids.lapsed, { entitlement_mode: 'free' });
await addSession('s-grant60', ids.grant60);
await addSession('s-grant7', ids.grant7);
await addSession('s-grant-blank', ids.grantBlankEmail);
await addSession('s-grant-spent', ids.grantSpent);

// ------------------------------------------------------------ existing plans

test('a free session of a free account stays locked: no summary, and nothing new is exposed', async () => {
  const before = await snapshot(ids.freeUsed);
  const { body } = await request('uid-free-used', 's-free');
  assert.equal(body.fullAccess, false);
  assert.equal(body.scorecard.partial, true);
  assert.deepEqual(buildInterviewSummary(body), { available: false, reason: 'locked' });
  assert.equal(await snapshot(ids.freeUsed), before);
});

test('pack, subscription and previously paid accounts keep full access and can export', async () => {
  for (const [uid, sessionId] of [['uid-pack', 's-pack'], ['uid-subscriber', 's-sub'], ['uid-lapsed', 's-lapsed-free']]) {
    const { body } = await request(uid, sessionId);
    assert.equal(body.fullAccess, true, uid);
    const summary = buildInterviewSummary(body);
    assert.equal(summary.available, true, uid);
    assert.equal(summary.wentWell[0].text, 'You stayed calm and specific.');
  }
});

// ------------------------------------------------------------ manual grants

test('a manually granted account with sixty sessions and no paid subscription can export', async () => {
  const ent = await getVoiceEntitlement(env, 'uid-grant-60');
  assert.deepEqual({ mode: ent.mode, canStart: ent.canStart, unlimited: ent.unlimited, sessionsRemaining: ent.sessionsRemaining, plan: ent.plan, hasEverPaid: ent.hasEverPaid },
    { mode: 'pack', canStart: true, unlimited: false, sessionsRemaining: 60, plan: 'free', hasEverPaid: false },
    'the grant is honored by the existing credit rules, with no checkout and no plan');

  const before = await snapshot(ids.grant60);
  const { body } = await request('uid-grant-60', 's-grant60');
  assert.equal(body.fullAccess, true);
  const summary = buildInterviewSummary(body);
  assert.equal(summary.available, true);
  const pdf = await readPdf(await renderSummaryPdf(summary, loadPdfDeps()));
  assert.ok(pdf.text.includes('You stayed calm and specific.'));
  assert.ok(!pdf.text.includes('uid-grant-60') && !pdf.text.includes('example.test') && !pdf.text.includes('s-grant60'),
    'no account identifier or email reaches the PDF');
  assert.equal(await snapshot(ids.grant60), before);
});

test('a manually granted account with a different balance behaves the same: sixty is not special', async () => {
  const ent = await getVoiceEntitlement(env, 'uid-grant-7');
  assert.equal(ent.sessionsRemaining, 7);
  assert.equal(ent.mode, 'pack');
  const before = await snapshot(ids.grant7);
  const { body } = await request('uid-grant-7', 's-grant7');
  assert.equal(body.fullAccess, true);
  assert.equal(buildInterviewSummary(body).available, true);
  assert.equal(await snapshot(ids.grant7), before);
  const user = await db.prepare('SELECT voice_sessions_remaining FROM users WHERE id = ?').bind(ids.grant7).first();
  assert.equal(user.voice_sessions_remaining, 7, 'the balance is neither refilled nor normalized');
});

test('access follows the signed-in identity and its credits, not the email field', async () => {
  const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(ids.grantBlankEmail).first();
  assert.equal(user.email, null, 'fixture: the app email field is blank');
  const before = await snapshot(ids.grantBlankEmail);
  const { status, body } = await request('uid-grant-blank-email', 's-grant-blank');
  assert.equal(status, 200);
  assert.equal(body.fullAccess, true);
  assert.equal(buildInterviewSummary(body).available, true);
  assert.equal(await snapshot(ids.grantBlankEmail), before, 'the blank email is not filled in or touched');
});

test('a granted session keeps its report after the grant is fully used', async () => {
  const ent = await getVoiceEntitlement(env, 'uid-grant-spent');
  assert.equal(ent.sessionsRemaining, 0);
  const { body } = await request('uid-grant-spent', 's-grant-spent');
  assert.equal(body.fullAccess, true, 'the session itself was a granted (pack mode) session');
  assert.equal(buildInterviewSummary(body).available, true);
});

// ------------------------------------------------------------ no side effects

test('viewing and exporting repeatedly never changes any stored field, for every account type', async () => {
  const cases = [
    ['uid-free-used', 's-free', ids.freeUsed], ['uid-pack', 's-pack', ids.pack], ['uid-subscriber', 's-sub', ids.subscriber],
    ['uid-lapsed', 's-lapsed-free', ids.lapsed], ['uid-grant-60', 's-grant60', ids.grant60], ['uid-grant-7', 's-grant7', ids.grant7],
    ['uid-grant-blank-email', 's-grant-blank', ids.grantBlankEmail]
  ];
  for (const [uid, sessionId, userId] of cases) {
    const before = await snapshot(userId);
    const entBefore = JSON.stringify(await getVoiceEntitlement(env, uid));
    const summaries = await exportTimes(uid, sessionId, 5);
    assert.equal(new Set(summaries.map((s) => JSON.stringify(s))).size, 1, 'the same report always yields the same summary');
    assert.equal(await snapshot(userId), before, uid + ': account, sessions and session count are byte-identical');
    assert.equal(JSON.stringify(await getVoiceEntitlement(env, uid)), entBefore, uid + ': entitlement is unchanged');
  }
});

test('starting a real interview still spends exactly one credit, and exports around it spend none', async () => {
  for (const [uid, userId, sessionId, start] of [['uid-grant-60', ids.grant60, 's-grant60', 60], ['uid-grant-7', ids.grant7, 's-grant7', 7]]) {
    await exportTimes(uid, sessionId, 2);
    const reserved = await reserveVoiceSession(env, { sessionId: 'new-' + uid, userRowId: userId, role: 'Engineer', seniority: null, jd: null, mode: 'pack', model: 'test' });
    assert.equal(reserved.inserted, true);
    const balance = async () => (await db.prepare('SELECT voice_sessions_remaining AS n FROM users WHERE id = ?').bind(userId).first()).n;
    assert.equal(await balance(), start - 1, uid + ': one start spends one credit');
    await assert.rejects(reserveVoiceSession(env, { sessionId: 'new-' + uid, userRowId: userId, role: 'Engineer', seniority: null, jd: null, mode: 'pack', model: 'test' }));
    assert.equal(await balance(), start - 1, uid + ': the same session id cannot spend twice');
    await exportTimes(uid, sessionId, 3);
    assert.equal(await balance(), start - 1, uid + ': exporting never spends');
    assert.equal((await getVoiceEntitlement(env, uid)).sessionsRemaining, start - 1);
  }
  const untouched = await db.prepare('SELECT voice_sessions_remaining AS n FROM users WHERE id = ?').bind(ids.grantBlankEmail).first();
  assert.equal(untouched.n, 12, 'other accounts are unaffected');
});

test('a free account is not moved toward checkout or charged by a locked export attempt', async () => {
  const before = await snapshot(ids.freeUsed);
  const summaries = await exportTimes('uid-free-used', 's-free', 3);
  assert.ok(summaries.every((s) => !s.available && s.reason === 'locked'));
  assert.equal(await snapshot(ids.freeUsed), before);
});

// ------------------------------------------------------------ ownership

test('another signed-in user cannot read or export someone else\'s report', async () => {
  const before = await snapshot(ids.grant60);
  for (const uid of ['uid-stranger', 'uid-grant-7', 'uid-free-used']) {
    const { status, body } = await request(uid, 's-grant60');
    assert.equal(status, 404, uid + ' must not see the session');
    assert.equal(body.scorecard, undefined);
    assert.equal(body.transcript, undefined);
    assert.deepEqual(buildInterviewSummary(body.error ? null : body), { available: false, reason: 'missing' });
  }
  assert.equal(await snapshot(ids.grant60), before);
});

test('an unknown session id is a 404 and never a summary', async () => {
  const { status } = await request('uid-grant-60', 'no-such-session');
  assert.equal(status, 404);
});

// ------------------------------------------------------------ report states

test('expired, too-short, safety-ended, pending and deleted sessions never export', async () => {
  const uid = 'uid-pack';
  await addSession('s-expired', ids.pack, { started_at: dbTime(120), ended_at: dbTime(120) });
  await addSession('s-too-short', ids.pack, { scorecard_json: JSON.stringify(TOO_SHORT) });
  await addSession('s-safety', ids.pack, { end_reason: 'ended_for_safety' });
  await addSession('s-pending', ids.pack, { scorecard_json: null });
  await addSession('s-broken', ids.pack, { scorecard_json: '{not json' });
  await addSession('s-deleted', ids.pack);

  const reason = async (sessionId) => buildInterviewSummary((await request(uid, sessionId)).body).reason;
  assert.equal(await reason('s-expired'), 'expired');
  assert.equal(await reason('s-too-short'), 'too_short');
  assert.equal(await reason('s-safety'), 'safety', 'a legacy safety row with a stored scorecard still exports nothing');
  assert.equal(await reason('s-pending'), 'pending');
  assert.equal(await reason('s-broken'), 'pending', 'an unreadable stored report is treated as not ready');

  assert.equal((await request(uid, 's-deleted', 'DELETE')).status, 200);
  assert.equal((await request(uid, 's-deleted')).status, 404);

  // The history rail agrees with the report on which rows are exportable.
  const ent = await getVoiceEntitlement(env, uid);
  const rows = await listVoiceSessions(env, ids.pack, ent);
  assert.ok(!rows.some((r) => r.sessionId === 's-deleted' || r.sessionId === 's-expired'));
  assert.equal(rows.find((r) => r.sessionId === 's-safety').status, 'safety');
});
