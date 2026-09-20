// Execute the real reservation SQL against SQLite, including rollback faults.
// Python's standard sqlite3 keeps this runnable on Node 18 CI without a native npm dependency.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveVoiceSession } from '../voice-entitlements.js';

const dir = mkdtempSync(join(tmpdir(), 'voice-reservation-'));
const file = join(dir, 'test.sqlite');
const python = `
import sqlite3, json, sys
db=sqlite3.connect(sys.argv[1]); db.row_factory=sqlite3.Row
data=json.load(sys.stdin)
try:
  if 'script' in data: db.executescript(data['script']); result=[]
  else:
    db.execute('BEGIN')
    result=[]
    for item in data['statements']:
      cur=db.execute(item['sql'], item.get('args',[]))
      result.append({'results':[dict(r) for r in cur.fetchall()], 'meta':{'changes':max(cur.rowcount,0)}})
  db.commit(); print(json.dumps(result))
except Exception as e:
  db.rollback(); print(json.dumps({'error':str(e)}))
finally: db.close()
`;
function execute(data) {
  const result = JSON.parse(execFileSync('python3', ['-c', python, file], { input: JSON.stringify(data), encoding: 'utf8' }));
  if (result.error) throw new Error(result.error);
  return result;
}
const sql = (query, args = []) => execute({ statements: [{ sql: query, args }] })[0];
let beforeRun = null;
const db = {
  prepare(query) {
    return { bind(...args) {
      return { sql: query, args,
        async run() { if (beforeRun) beforeRun(query); return sql(query, args); },
        async first() { return sql(query, args).results[0] || null; }
      };
    } };
  },
  async batch(statements) { return execute({ statements }); }
};
const env = { DB: db, VOICE_INTERVIEW_ENABLED: 'true' };
const session = (id, mode = 'pack') => ({ sessionId: id, userRowId: 1, role: 'Engineer', seniority: null, jd: null, mode, model: 'test' });
function reset() {
  execute({ script: `DROP TABLE IF EXISTS voice_sessions; DROP TABLE IF EXISTS users;
    CREATE TABLE users (id INTEGER PRIMARY KEY, auth_id TEXT, email TEXT, plan TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO users VALUES (1, 'test-user', NULL, 'free', NULL, NULL);` +
    readFileSync(new URL('../../../db/migrations/020_add_voice_entitlements.sql', import.meta.url), 'utf8') +
    readFileSync(new URL('../../../db/migrations/021_add_voice_end_reason.sql', import.meta.url), 'utf8') });
  sql('UPDATE users SET voice_sessions_remaining = 2');
}
const user = () => sql('SELECT * FROM users').results[0];
const rows = () => sql('SELECT * FROM voice_sessions').results;

try {
  reset();
  assert.equal((await reserveVoiceSession(env, session('first'))).inserted, true);
  assert.equal(user().voice_sessions_remaining, 1);
  assert.equal(rows().length, 1);
  await assert.rejects(reserveVoiceSession(env, session('first')), /UNIQUE/);
  assert.equal(user().voice_sessions_remaining, 1, 'duplicate id cannot spend again');

  reset();
  execute({ script: "CREATE TRIGGER fail_credit BEFORE UPDATE ON users BEGIN SELECT RAISE(ABORT, 'credit write failed'); END;" });
  await assert.rejects(reserveVoiceSession(env, session('fault')), /credit write failed/);
  assert.equal(rows().length, 0, 'failed credit update rolls back the recovery row');
  assert.equal(user().voice_sessions_remaining, 2);

  reset();
  execute({ script: "CREATE TRIGGER fail_row BEFORE INSERT ON voice_sessions BEGIN SELECT RAISE(ABORT, 'row write failed'); END;" });
  await assert.rejects(reserveVoiceSession(env, session('fault')), /row write failed/);
  assert.equal(user().voice_sessions_remaining, 2, 'failed row cannot spend credit');

  reset();
  const free = await Promise.all([reserveVoiceSession(env, session('free-a', 'free')), reserveVoiceSession(env, session('free-b', 'free'))]);
  assert.equal(free.filter(r => r.inserted).length, 1);
  assert.equal(user().free_session_used, 1);
  assert.equal(rows().length, 1);

  reset();
  const pack = await Promise.all(['a', 'b', 'c'].map(id => reserveVoiceSession(env, session(id))));
  assert.equal(pack.filter(r => r.inserted).length, 2);
  assert.equal(user().voice_sessions_remaining, 0);
  assert.equal(rows().length, 2);
  assert.equal((await reserveVoiceSession(env, session('a'))).inserted, false);
  assert.equal(user().voice_sessions_remaining, 0, 'exhausted duplicate cannot decrement below zero');

  reset();
  sql("UPDATE users SET pack_expires_at = datetime('now', '-1 day')");
  assert.equal((await reserveVoiceSession(env, session('expired'))).inserted, false);
  assert.equal(rows().length, 0);
  assert.equal(user().voice_sessions_remaining, 2);

  reset();
  sql('UPDATE users SET pack_expires_at = ?', [new Date(Date.now() + 86400000).toISOString()]);
  assert.equal((await reserveVoiceSession(env, session('iso-future'))).inserted, true, 'SQLite accepts ISO expiry including milliseconds and trailing Z');
  sql('UPDATE users SET pack_expires_at = ?', [new Date(Date.now() - 86400000).toISOString()]);
  assert.equal((await reserveVoiceSession(env, session('iso-expired'))).inserted, false);

  reset();
  const capped = { ...env, VOICE_FAIR_USE_CAP: '1' };
  assert.equal((await reserveVoiceSession(capped, session('sub1', 'subscription'))).inserted, true);
  assert.equal((await reserveVoiceSession(capped, session('sub2', 'subscription'))).reason, 'limit_reached');

  // Run the real completion handler, stubbing only auth and score generation.
  // Inject the winning completion after the handler SELECT but before UPDATE.
  reset();
  await reserveVoiceSession(env, session('race'));
  const endpointUrl = new URL('../../api/voice/session/[id]/complete.js', import.meta.url);
  let source = readFileSync(endpointUrl, 'utf8').replace(/from '([^']+)'/g, (_, path) => {
    if (path.endsWith('/firebase-auth.js')) return "from 'data:text/javascript," + encodeURIComponent("export const getBearer=()=> 'test'; export const verifyFirebaseIdToken=async()=>({uid:'test-user'});").replace(/'/g, '%27') + "'";
    if (path.endsWith('/voice-scorecard.js')) return "from 'data:text/javascript," + encodeURIComponent('export async function generateAndStoreScorecard() { return true; }') + "'";
    return `from '${new URL(path, endpointUrl).href}'`;
  });
  const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source + '\n//# sourceURL=voice-complete-test.js').toString('base64'));
  const scheduled = [];
  beforeRun = query => {
    if (!query.includes("status = 'completed'")) return;
    beforeRun = null;
    sql("UPDATE voice_sessions SET status='completed', end_reason='ended_for_safety', transcript_json='[]', duration_seconds=12 WHERE id='race'");
  };
  const request = () => new Request('https://qa.jobhackai.io/api/voice/session/race/complete', { method: 'POST', body: JSON.stringify({ reason: 'user_ended', transcript: [{ speaker: 'user', text: 'late overwrite' }], durationSeconds: 99 }) });
  const response = await onRequest({ request: request(), env, params: { id: 'race' }, waitUntil: p => scheduled.push(p) });
  assert.equal(response.status, 200);
  assert.equal(rows()[0].end_reason, 'ended_for_safety');
  assert.equal(rows()[0].transcript_json, '[]');
  assert.equal(rows()[0].duration_seconds, 12);
  assert.equal(scheduled.length, 0, 'losing normal completion cannot score a safety winner');
  const retry = await onRequest({ request: request(), env, params: { id: 'race' }, waitUntil: p => scheduled.push(p) });
  assert.equal(retry.status, 200);
  assert.equal(scheduled.length, 0);
  // Provider rejection never consumes; a lost success response can be retried
  // by the same client id even after the lifetime free entitlement is spent.
  reset();
  sql('ALTER TABLE users ADD COLUMN subscription_status TEXT');
  sql('ALTER TABLE users ADD COLUMN current_period_end TEXT');
  sql('ALTER TABLE users ADD COLUMN has_ever_paid INTEGER DEFAULT 0');
  sql('ALTER TABLE users ADD COLUMN last_login_at TEXT');
  sql('ALTER TABLE users ADD COLUMN deletion_warning_sent_at TEXT');
  sql('UPDATE users SET voice_sessions_remaining=0');
  const startUrl = new URL('../../api/voice/session.js', import.meta.url);
  const startSource = readFileSync(startUrl, 'utf8').replace(/from '([^']+)'/g, (_, path) => {
    if (path.endsWith('/firebase-auth.js')) return "from 'data:text/javascript;base64," + Buffer.from("export const getBearer=()=> 'test'; export const verifyFirebaseIdToken=async()=>({uid:'test-user',payload:{name:'Test'}});").toString('base64') + "'";
    return `from '${new URL(path, startUrl).href}'`;
  });
  const start = (await import('data:text/javascript;base64,' + Buffer.from(startSource + '\n//# sourceURL=voice-start-test.js').toString('base64'))).onRequest;
  const realFetch = globalThis.fetch;
  const startEnv = { ...env, ENVIRONMENT: 'qa', OPENAI_API_KEY: 'test-only' };
  const startId = '11111111-1111-4111-8111-111111111111';
  const startRequest = () => new Request('https://qa.jobhackai.io/api/voice/session', { method: 'POST', body: JSON.stringify({ role: 'Engineer', startRequestId: startId }) });
  try {
    globalThis.fetch = async () => new Response('{}', { status: 502 });
    assert.equal((await start({ request: startRequest(), env: startEnv })).status, 502);
    assert.equal(user().free_session_used, 0);
    assert.equal(rows().length, 0);
    globalThis.fetch = async () => new Response(JSON.stringify({ value: 'fake-ephemeral-secret' }));
    assert.equal((await start({ request: startRequest(), env: startEnv })).status, 200);
    assert.equal(user().free_session_used, 1);
    const recovered = await start({ request: startRequest(), env: startEnv });
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).resumed, true);
    assert.equal(rows().length, 1);
    // Assert the actual wire response, not a client-only fixture: the shared
    // response helper must expose these reasons outside development too.
    sql("UPDATE voice_sessions SET started_at=datetime('now','-1 hour') WHERE id=?", [startId]);
    const expired = await start({ request: startRequest(), env: startEnv });
    assert.equal(expired.status, 409);
    assert.equal((await expired.json()).reason, 'session_expired');
    const ended = await start({ request: startRequest(), env: { ...startEnv, ENVIRONMENT: 'production' } });
    assert.equal(ended.status, 409);
    assert.equal((await ended.json()).reason, 'session_ended');
    // Both initial lookups finish before either provider mint returns.
    // Test the last-credit zero-row path and the remaining-pack UNIQUE path.
    for (const mode of ['free', 'pack']) {
      sql('DELETE FROM voice_sessions');
      sql('UPDATE users SET free_session_used=0, voice_sessions_remaining=?, pack_expires_at=NULL', [mode === 'pack' ? 2 : 0]);
      let mintCount = 0;
      const releases = [];
      globalThis.fetch = async () => {
        mintCount++;
        if (mintCount <= 2) await new Promise(resolve => {
          releases.push(resolve);
          if (releases.length === 2) releases.forEach(fn => fn());
        });
        return new Response(JSON.stringify({ value: 'fake-ephemeral-secret' }));
      };
      const simultaneous = await Promise.all([1,2].map(() => start({ request: startRequest(), env: startEnv })));
      assert.deepEqual(simultaneous.map(r => r.status), [200,200]);
      const payloads = await Promise.all(simultaneous.map(r => r.json()));
      assert.equal(payloads.filter(p => p.resumed).length, 1);
      assert.equal(rows().length, 1);
      assert.equal(mode === 'pack' ? user().voice_sessions_remaining : user().free_session_used, 1);
    }
  } finally { globalThis.fetch = realFetch; }
  console.log('Voice reservation rollback, competing starts, expiry, cap, and completion race checks passed.');
} finally { rmSync(dir, { recursive: true, force: true }); }
