import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { normalizeGrant, preparePilotGrant, applyPilotGrant, pilotReport, pilotApi } from './src/pilot.js';
import { allowed } from './src/access.js';
import { getVoiceEntitlement, reserveVoiceSession } from '../../app/functions/_lib/voice-entitlements.js';
import { sessionFullAccess } from '../../app/functions/_lib/voice-history.js';

const NOW = new Date();
NOW.setMilliseconds(0);
const START = new Date(NOW.getTime() - 3600000).toISOString();
const END = new Date(Date.parse(START) + 30 * 86400000).toISOString();
const OWNER = { role: 'owner', id: 'sebastian.larosa@jobhackai.io' };
function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,auth_id TEXT UNIQUE,email TEXT,plan TEXT,subscription_status TEXT,current_period_end TEXT,stripe_customer_id TEXT,stripe_subscription_id TEXT,has_ever_paid INTEGER DEFAULT 0,updated_at TEXT);
    CREATE TABLE account_deletion_admissions(auth_id TEXT);
    INSERT INTO users(id,auth_id,email,plan) VALUES(1,'person1','person1@example.test','free'),(2,'person2','person2@example.test','free');`);
  for (const name of ['020_add_voice_entitlements.sql', '021_add_voice_end_reason.sql', '036_pilot_credit_grants.sql']) sql.exec(readFileSync(new URL('../../app/db/migrations/' + name, import.meta.url), 'utf8'));
  const db = {
    prepare(query) {
      return { query, args: [], bind(...args) { return { ...this, args }; }, async all() { return { results: sql.prepare(query).all(...this.args) }; }, async first() { return sql.prepare(query).get(...this.args) || null; }, async run() { const r = sql.prepare(query).run(...this.args); return { meta: { changes: Number(r.changes) } }; } };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
  };
  t.after(() => sql.close());
  const input = { id: 'brighton-person-01', cohortId: 'brighton-2026-11', email: 'person1@example.test', role: 'participant', startsAt: START, expiresAt: END };
  return { db, sql, input, user: () => sql.prepare('SELECT * FROM users WHERE id=1').get(), async enroll(changes = {}) { const data = { ...input, ...changes }; const p = await preparePilotGrant(db, data, NOW); return applyPilotGrant(db, { ...data, expectedRevision: p.revision, confirmAccountOwner: true }, OWNER.id, NOW); } };
}

test('preview does not change access, and one grant preserves billing and lifetime free rights', async t => {
  const h = fixture(t), before = h.user();
  const preview = await preparePilotGrant(h.db, h.input, NOW);
  assert.equal(preview.grant.credits, 60); assert.deepEqual(h.user(), before);
  const result = await h.enroll(); assert.equal(result.applied, true);
  const after = h.user();
  assert.equal(after.voice_sessions_remaining, 60); assert.equal(after.pack_expires_at, END);
  for (const key of ['plan','subscription_status','stripe_customer_id','stripe_subscription_id','has_ever_paid','free_session_used']) assert.equal(after[key], before[key]);
  assert.equal((await h.enroll()).duplicate, true); assert.equal(h.user().voice_sessions_remaining, 60);
  await assert.rejects(h.enroll({ id: 'brighton-person-new' }), /already enrolled/);
});

test('account changes invalidate a preview and paid or existing credits are never overwritten', async t => {
  const h = fixture(t); const p = await preparePilotGrant(h.db, h.input, NOW);
  h.sql.exec('UPDATE users SET free_session_used=1 WHERE id=1');
  await assert.rejects(applyPilotGrant(h.db, { ...h.input, expectedRevision: p.revision, confirmAccountOwner: true }, OWNER.id, NOW), /changed/);
  for (const update of ["subscription_status='active'", 'voice_sessions_remaining=4', 'has_ever_paid=1', "stripe_subscription_id='sub_existing'"]) {
    h.sql.exec('UPDATE users SET subscription_status=NULL,voice_sessions_remaining=0,has_ever_paid=0,stripe_subscription_id=NULL WHERE id=1');
    h.sql.exec('UPDATE users SET ' + update + ' WHERE id=1');
    await assert.rejects(h.enroll(), /billing history/);
  }
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM pilot_credit_grants').get().n, 0);
});

test('duplicate execution race never adds 120 credits', async t => {
  const h = fixture(t); const p = await preparePilotGrant(h.db, h.input, NOW);
  const realBatch = h.db.batch.bind(h.db);
  let intervened = false;
  h.db.batch = async statements => {
    if (!intervened) { intervened = true; h.db.batch = realBatch; await h.enroll(); }
    return realBatch(statements);
  };
  const r = await applyPilotGrant(h.db, { ...h.input, expectedRevision: p.revision, confirmAccountOwner: true }, OWNER.id, NOW);
  assert.equal(r.duplicate, true); assert.equal(h.user().voice_sessions_remaining, 60);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM pilot_credit_grants').get().n, 1);
});

test('a failed credit write rolls the audit insert back', async t => {
  const h = fixture(t);
  h.sql.exec("CREATE TRIGGER fail_credit BEFORE UPDATE OF voice_sessions_remaining ON users BEGIN SELECT RAISE(ABORT,'forced failure'); END;");
  await assert.rejects(h.enroll(), /forced failure/);
  assert.equal(h.user().voice_sessions_remaining, 0);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM pilot_credit_grants').get().n, 0);
});

test('future participant launch is previewable but cannot activate early; staff prep has independent dates', async t => {
  const h = fixture(t), startsAt = new Date(NOW.getTime() + 86400000).toISOString(), expiresAt = new Date(NOW.getTime() + 31 * 86400000).toISOString();
  await preparePilotGrant(h.db, { ...h.input, startsAt, expiresAt }, NOW);
  await assert.rejects(h.enroll({ startsAt, expiresAt }), /not started/);
  await h.enroll({ role: 'specialist', startsAt: new Date(Date.parse(START) - 2 * 86400000).toISOString() });
  assert.equal(h.user().pack_expires_at, END);
  assert.throws(() => normalizeGrant({ ...h.input, expiresAt: new Date(Date.parse(END) + 86400000).toISOString() }, NOW), /30 days/);
});

test('existing entitlement gate consumes all 60 credits and report access survives depletion and expiry', async t => {
  const h = fixture(t); h.sql.exec('UPDATE users SET free_session_used=1 WHERE id=1'); await h.enroll();
  const env = { DB: h.db };
  for (let i = 0; i < 60; i++) {
    const entitlement = await getVoiceEntitlement(env, 'person1');
    assert.equal(entitlement.mode, 'pack'); assert.equal(entitlement.sessionsRemaining, 60 - i);
    assert.equal((await reserveVoiceSession(env, { sessionId: 'pilot-' + i, userRowId: 1, role: 'Coordinator', seniority: null, jd: null, mode: entitlement.mode, model: 'test' })).inserted, true);
  }
  const exhausted = await getVoiceEntitlement(env, 'person1');
  assert.equal(exhausted.canStart, false); assert.equal(exhausted.hasEverPaid, false);
  assert.equal(sessionFullAccess({ entitlement_mode: 'pack' }, exhausted), true);
  assert.equal((await reserveVoiceSession(env, { sessionId: 'pilot-61', userRowId: 1, role: 'Coordinator', seniority: null, jd: null, mode: 'pack', model: 'test' })).inserted, false);
  h.sql.exec("UPDATE users SET voice_sessions_remaining=2,pack_expires_at='2000-01-01T00:00:00Z' WHERE id=1");
  assert.equal((await getVoiceEntitlement(env, 'person1')).canStart, false);
});

test('unused lifetime free interview remains visible as additional access rather than a false hard cap', async t => {
  const h = fixture(t); await h.enroll(); h.sql.exec('UPDATE users SET voice_sessions_remaining=0 WHERE id=1');
  const entitlement = await getVoiceEntitlement({ DB: h.db }, 'person1');
  assert.equal(entitlement.mode, 'free'); assert.equal(entitlement.canStart, true);
  const row = (await pilotReport(h.db, NOW)).items[0];
  assert.equal(row.remaining, 0); assert.equal(row.usedCredits, 60); assert.equal(row.freeSessionAvailable, true);
});

test('dashboard distinguishes consumed credits, retained history, expiry and changed billing', async t => {
  const h = fixture(t); await h.enroll();
  h.sql.exec(`UPDATE users SET voice_sessions_remaining=58 WHERE id=1;
    INSERT INTO voice_sessions(id,user_id,status,entitlement_mode,started_at) VALUES('one',1,'completed','pack','${NOW.toISOString()}'),('two',1,'abandoned','pack','${NOW.toISOString()}');`);
  let row = (await pilotReport(h.db, NOW)).items[0];
  assert.equal(row.usedCredits, 2); assert.equal(row.retainedStarts, 2); assert.equal(row.retainedCompletions, 1);
  h.sql.exec("DELETE FROM voice_sessions WHERE id='one'"); row = (await pilotReport(h.db, NOW)).items[0];
  assert.equal(row.usedCredits, 2); assert.equal(row.retainedCompletions, 0);
  row = (await pilotReport(h.db, new Date(Date.parse(END) + 1))).items[0]; assert.equal(row.status, 'expired'); assert.equal(row.remaining, 0); assert.equal(row.unusedCredits, 58);
  h.sql.exec('UPDATE users SET has_ever_paid=1 WHERE id=1'); row = (await pilotReport(h.db, NOW)).items[0]; assert.equal(row.status, 'review_access'); assert.equal(row.remaining, null);
});

test('account deletion blocks provisioning and removes the linked pilot record', async t => {
  const h = fixture(t); h.sql.exec("INSERT INTO account_deletion_admissions VALUES('person1')");
  await assert.rejects(h.enroll(), /deletion/); h.sql.exec('DELETE FROM account_deletion_admissions');
  await h.enroll(); h.sql.exec('DELETE FROM users WHERE id=1');
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM pilot_credit_grants').get().n, 0);
});

test('private API rejects machines, missing origin, disabled feature and oversized body', async t => {
  const h = fixture(t), env = { PRODUCTION_DB: h.db, PILOT_ADMIN_ENABLED: 'true' };
  const url = 'https://dashboard.example.test/api/pilot';
  const machine = { role: 'machine', capabilities: ['read','prepare','reconcile','coordinate'] };
  for (const method of ['GET','POST']) assert.equal(allowed(machine, method, '/api/pilot'), false);
  assert.equal((await pilotApi(new Request(url), env, machine, NOW)).status, 403);
  assert.equal((await pilotApi(new Request(url), { ...env, PILOT_ADMIN_ENABLED: 'false' }, OWNER, NOW)).status, 404);
  assert.equal((await pilotApi(new Request(url, { method: 'POST', body: '{}' }), env, OWNER, NOW)).status, 403);
  assert.equal((await pilotApi(new Request(url, { method: 'POST', headers: { origin: 'https://dashboard.example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(5000) }) }), env, OWNER, NOW)).status, 413);
});

test('capacity is enforced per role and unavailable schema is not reported as zero', async t => {
  const h = fixture(t);
  for (let n = 3; n <= 5; n++) h.sql.exec(`INSERT INTO users(id,auth_id,email,plan) VALUES(${n},'person${n}','person${n}@example.test','free');`);
  for (let n = 1; n <= 3; n++) await h.enroll({ id: `brighton-specialist-0${n}`, email: `person${n}@example.test`, role: 'specialist' });
  await assert.rejects(h.enroll({ id: 'brighton-specialist-04', email: 'person4@example.test', role: 'specialist' }), /capacity/);
  h.sql.exec('DROP TABLE pilot_credit_grants');
  const response = await pilotApi(new Request('https://dashboard.example.test/api/pilot'), { PRODUCTION_DB: h.db, PILOT_ADMIN_ENABLED: 'true' }, OWNER, NOW);
  assert.equal(response.status, 503); assert.match((await response.json()).error, /unavailable/);
});
