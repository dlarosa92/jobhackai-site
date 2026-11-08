// Execute the real report/history/delete routes and helpers against SQLite.
// Only Firebase token verification is replaced. No remote service is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { sqliteD1 } from './sqlite-d1-helper.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const auth = `
  export const getBearer = request => request.headers.get('Authorization')?.replace(/^Bearer /, '') || null;
  export async function verifyFirebaseIdToken(token) {
    if (!['owner', 'other'].includes(token)) throw Error('invalid fixture token');
    return { uid: token };
  }
`;
async function loadRoute(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const source = readFileSync(url, 'utf8').replace(/from '([^']+)'/g, (_, path) => {
    const target = path.endsWith('/firebase-auth.js')
      ? 'data:text/javascript;base64,' + Buffer.from(auth).toString('base64')
      : new URL(path, url).href;
    return `from '${target}'`;
  });
  return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).onRequest;
}
const report = await loadRoute('../../api/voice/session/[id].js');
const history = await loadRoute('../../api/voice/sessions.js');
const clear = await loadRoute('../../api/voice/sessions/clear.js');
const transcript = [{ speaker: 'assistant', text: 'What did you improve?' },
  { speaker: 'user', text: 'I reduced repeated setup work by documenting the process.' }];
const scorecard = { methodologyVersion: 2, overall: 72, topStrength: 'Concrete example.',
  topImprovement: 'Explain your own decision.', summary: 'Private detailed summary.',
  dimensions: { structure: 70 }, moments: [{ quote: transcript[1].text, comment: 'Private coaching.' }] };

function setup(t) {
  const db = sqliteD1();
  t.after(() => db.close());
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, auth_id TEXT UNIQUE, email TEXT, plan TEXT,
    created_at TEXT, updated_at TEXT, subscription_status TEXT, current_period_end TEXT,
    has_ever_paid INTEGER NOT NULL DEFAULT 0);
    INSERT INTO users(id,auth_id,email,plan,has_ever_paid) VALUES
      (1,'owner','owner@example.test','pack',1),(2,'other','other@example.test','free',0);`);
  for (const name of ['020_add_voice_entitlements.sql', '021_add_voice_end_reason.sql',
    '029_voice_usage_evidence.sql', '033_voice_early_end_grace.sql']) {
    db.exec(readFileSync(new URL('../../../db/migrations/' + name, import.meta.url), 'utf8'));
  }
  db.exec(`UPDATE users SET free_session_used=1;
    UPDATE users SET voice_sessions_remaining=3,voice_grace_session_id='previous-grace',
      voice_grace_used_at='2026-01-01 00:00:00' WHERE id=1;`);
  const env = { DB: db, VOICE_INTERVIEW_ENABLED: 'true', ENVIRONMENT: 'test' };
  const query = (sql, ...args) => db.prepare(sql).bind(...args);
  async function add(id, { user = 1, status = 'completed', mode = 'pack', daysAgo = 1 } = {}) {
    await query(`INSERT INTO voice_sessions
      (id,user_id,role,seniority,jd_excerpt,status,entitlement_mode,started_at,ended_at,
       duration_seconds,transcript_json,scorecard_json,usage_details_json,end_reason)
      VALUES (?,?,?,?,?,?,?,datetime('now',?),datetime('now',?),?,?,?,?,?)`,
    id, user, 'Private role ' + id, 'Private seniority', 'Private job context', status, mode,
    `-${daysAgo} days`, `-${daysAgo} days`, 60, JSON.stringify(transcript),
    JSON.stringify(scorecard), '{"privateUsageMarker":1}', 'user_ended').run();
  }
  async function call(handler, { method = 'GET', token = 'owner', id = 'own', suffix = '' } = {}) {
    const path = handler === report ? '/api/voice/session/' + encodeURIComponent(id)
      : handler === history ? '/api/voice/sessions' : '/api/voice/sessions/clear';
    const headers = token === null ? {} : { Authorization: 'Bearer ' + token };
    const response = await handler({ env, params: { id },
      request: new Request('https://dev.jobhackai.io' + path + suffix, { method, headers }) });
    return { status: response.status, body: await response.json(), cache: response.headers.get('Cache-Control') };
  }
  return { db, env, query, add, call,
    rows: () => db.prepare('SELECT * FROM voice_sessions ORDER BY id').all().then(r => r.results),
    users: () => db.prepare('SELECT * FROM users ORDER BY id').all().then(r => r.results) };
}

test('missing or invalid authentication cannot read or delete voice content', async t => {
  const f = setup(t); await f.add('own');
  const before = await f.rows();
  for (const token of [null, 'invalid']) {
    for (const [route, method] of [[report, 'GET'], [report, 'DELETE'], [history, 'GET'], [clear, 'POST']]) {
      const r = await f.call(route, { token, method });
      assert.equal(r.status, 401); assert.equal(r.cache, 'no-store');
      assert.ok(!JSON.stringify(r.body).includes('Private'));
    }
  }
  assert.deepEqual(await f.rows(), before);
});

test('another account cannot read or delete a known session or inject a session ID', async t => {
  const f = setup(t); await f.add('own'); await f.add('peer', { user: 2, mode: 'free' });
  const before = await f.rows();
  for (const method of ['GET', 'DELETE']) {
    for (const id of ['peer', 'missing', "peer' OR 1=1 --"]) {
      const r = await f.call(report, { method, id });
      assert.equal(r.status, 404); assert.equal(r.body.error, 'Session not found');
      assert.ok(!JSON.stringify(r.body).includes('Private'));
    }
  }
  assert.deepEqual(await f.rows(), before);
  const own = await f.call(report);
  assert.equal(own.status, 200); assert.equal(own.body.fullAccess, true);
  assert.deepEqual(own.body.transcript, transcript);
});

test('history lists only this account completed sessions and ignores forged owner parameters', async t => {
  const f = setup(t);
  await f.add('own'); await f.add('peer', { user: 2, mode: 'free' });
  await f.add('active', { status: 'active' }); await f.add('abandoned', { status: 'abandoned' });
  const r = await f.call(history, { suffix: '?user_id=2&uid=other' });
  assert.equal(r.status, 200); assert.deepEqual(r.body.sessions.map(s => s.sessionId), ['own']);
  assert.ok(!JSON.stringify(r.body).includes('peer'));
  assert.ok(!JSON.stringify(r.body).includes(transcript[1].text));
});

test('selected deletion removes the complete row once without changing other content or entitlements', async t => {
  const f = setup(t); await f.add('own'); await f.add('keep'); await f.add('peer', { user: 2 });
  const users = await f.users(); const keep = (await f.rows()).filter(r => r.id !== 'own');
  const r = await f.call(report, { method: 'DELETE' });
  assert.equal(r.status, 200); assert.equal(r.body.success, true);
  assert.deepEqual(await f.rows(), keep);
  assert.deepEqual(await f.users(), users, 'deletion must not restore free use, credits or grace');
  assert.equal((await f.call(report)).status, 404);
  assert.equal((await f.call(report, { method: 'DELETE' })).status, 404);
});

test('selected deletion preserves created and active sessions', async t => {
  const f = setup(t);
  for (const status of ['created', 'active']) await f.add(status, { status });
  const before = await f.rows();
  for (const id of ['created', 'active']) assert.equal((await f.call(report, { method: 'DELETE', id })).status, 404);
  assert.deepEqual(await f.rows(), before);
});

test('clear history preserves other accounts, live sessions and all entitlement state', async t => {
  const f = setup(t);
  await f.add('own'); await f.add('abandoned', { status: 'abandoned' }); await f.add('old', { daysAgo: 91 });
  await f.add('active', { status: 'active' }); await f.add('created', { status: 'created' });
  await f.add('peer', { user: 2 });
  const keep = (await f.rows()).filter(r => ['active', 'created', 'peer'].includes(r.id));
  const users = await f.users();
  const r = await f.call(clear, { method: 'POST', suffix: '?user_id=2&uid=other' });
  assert.equal(r.status, 200); assert.equal(r.body.deleted, 3);
  assert.deepEqual(await f.rows(), keep); assert.deepEqual(await f.users(), users);
  assert.equal((await f.call(clear, { method: 'POST' })).body.deleted, 0);
});

test('expired reports with content still in storage redact private payloads for both paid and free accounts', async t => {
  const f = setup(t);
  await f.add('old-paid', { daysAgo: 91 });
  await f.add('old-free', { user: 2, mode: 'free', daysAgo: 91 });
  for (const [id, token] of [['old-paid', 'owner'], ['old-free', 'other']]) {
    const r = await f.call(report, { id, token });
    assert.equal(r.status, 200); assert.equal(r.body.expired, true);
    for (const key of ['role', 'seniority', 'scorecard', 'transcript']) assert.equal(r.body[key], null, key);
    assert.equal(r.body.fullAccess, false); assert.equal(r.cache, 'no-store');
    for (const text of ['Private', transcript[1].text, scorecard.topStrength, scorecard.topImprovement]) {
      assert.ok(!JSON.stringify(r.body).includes(text), text);
    }
  }
  assert.equal((await f.call(history)).body.sessions.length, 0);
  const freeHistory = (await f.call(history, { token: 'other' })).body.sessions;
  assert.equal(freeHistory.length, 1); assert.equal(freeHistory[0].reportAvailable, false);
  for (const key of ['role', 'seniority', 'overall', 'topImprovement']) assert.equal(freeHistory[0][key], null, key);
  assert.equal((await f.rows()).length, 2, 'read-time redaction does not claim scheduled deletion');
});

test('free report access cannot be upgraded with client parameters and historical paid access stays intact', async t => {
  const f = setup(t); await f.add('peer', { user: 2, mode: 'free' });
  const free = await f.call(report, { id: 'peer', token: 'other', suffix: '?fullAccess=true&user_id=1&uid=owner' });
  assert.equal(free.status, 200); assert.equal(free.body.fullAccess, false);
  assert.equal(free.body.transcript, null); assert.equal(free.body.scorecard.partial, true);
  for (const key of ['dimensions', 'moments', 'summary']) assert.equal(free.body.scorecard[key], null);
  assert.ok(!JSON.stringify(free.body).includes('Private coaching.'));
  await f.query('UPDATE users SET has_ever_paid=1 WHERE id=2').run();
  const paid = await f.call(report, { id: 'peer', token: 'other' });
  assert.equal(paid.body.fullAccess, true); assert.deepEqual(paid.body.transcript, transcript);
  assert.equal(paid.body.scorecard.summary, scorecard.summary);
});
