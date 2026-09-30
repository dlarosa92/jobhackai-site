import {inspectionSql,inspectReport,planReconciliation} from '../../../scripts/lib/account-operation-reconcile-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import worker, { sendFollowups } from '../../../../workers/voice-followup-email/src/index.js';
import { beginDeletionAdmission, assertDeletionQuiescent } from '../account-deletion-admission.js';
import { sqliteD1 } from './sqlite-d1-helper.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function setup(t) {
  const db = sqliteD1();
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8'));
  for(const name of ['024_collected_payments','025_checkout_attribution','026_payment_campaign_links','027_analytics_delivery','028_account_deletion_recovery'])
    db.exec(readFileSync(new URL('../../../db/migrations/'+name+'.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO users(id,auth_id,email,plan,free_session_used) VALUES(1,'owner','owner@example.test','free',1);
    INSERT INTO voice_sessions(id,user_id,status,entitlement_mode,ended_at,scorecard_json)
    VALUES('session',1,'completed','free',datetime('now','-49 hours'),'{"topImprovement":"Use a concrete result <img src=x onerror=alert(1)>"}');`);
  const env = { JOBHACKAI_DB: db, RESEND_API_KEY: 'fixture-only', FRONTEND_URL: 'https://qa.jobhackai.io', VOICE_INTERVIEW_ENABLED: 'true' };
  const calls = [];
  const originalFetch = globalThis.fetch;
  const fixture = { reply: async () => Response.json({ id: 'fixture-email' }) };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    calls.push({ url, options, body: JSON.parse(options.body) });
    return fixture.reply();
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return { db, env, calls, fixture, run: () => sendFollowups(env),
    marker: () => db.prepare('SELECT voice_followup_email_sent_at FROM users WHERE id=1').first('voice_followup_email_sent_at'),
    claims: () => db.prepare('SELECT * FROM account_operation_claims').all().then(r => r.results) };
}

test('one accepted follow-up holds admission, escapes content and describes real session limits', async t => {
  const f = setup(t);
  f.fixture.reply = async () => {
    assert.ok(await f.marker());
    assert.equal((await f.claims())[0].state, 'active');
    return Response.json({ id: 'fixture-email' });
  };
  await f.run(); await f.run();
  assert.equal(f.calls.length, 1);
  assert.equal((await f.claims())[0].state, 'finished');
  const call = f.calls[0];
  assert.equal(call.options.headers['Idempotency-Key'], `voice-followup/${(await f.claims())[0].id}`);
  assert.ok(call.options.signal);
  assert.match(call.body.html, /60 sessions per UTC calendar month/);
  assert.match(call.body.html, /five sessions valid for 90 days/);
  assert.doesNotMatch(call.body.html, /unlimited|<img/);
  assert.match(call.body.html, /&lt;img/);
  assert.deepEqual(call.body.to, ['owner@example.test']);
});

test('deletion before candidate selection or between selection and admission sends nothing', async t => {
  const f = setup(t);
  const originalPrepare = f.db.prepare;
  let intercepted = false;
  f.db.prepare = sql => {
    const stmt = originalPrepare(sql);
    if (sql.includes('SELECT u.id, u.auth_id')) {
      const all = stmt.all;
      stmt.all = async function () {
        const result = await all.call(this);
        if (!intercepted) { intercepted = true; await beginDeletionAdmission(f.env, {origin:'user_request', uid: 'owner' }); }
        return result;
      };
    }
    return stmt;
  };
  await f.run(); await f.run();
  assert.equal(f.calls.length, 0); assert.equal(await f.marker(), null);
  assert.deepEqual(await f.claims(), []);
});

test('a deletion intent waits through an earlier send; a simultaneous worker cannot duplicate it', async t => {
  const f = setup(t), entered = deferred(), release = deferred();
  f.fixture.reply = async () => { entered.resolve(); await release.promise; return Response.json({ id: 'fixture-email' }); };
  const first = f.run(); await entered.promise;
  await f.run(); assert.equal(f.calls.length, 1);
  await beginDeletionAdmission(f.env, {origin:'user_request', uid: 'owner' });
  await assert.rejects(assertDeletionQuiescent(f.env, 'owner'), /deletion_operations_pending/);
  release.resolve(); await first;
  await assertDeletionQuiescent(f.env, 'owner');
  await f.run(); assert.equal(f.calls.length, 1);
});

test('definitive rejection releases only the send marker and permits a later retry', async t => {
  const f = setup(t);
  f.fixture.reply = async () => new Response('private provider diagnostic', { status: 422 });
  await f.run();
  assert.equal(await f.marker(), null); assert.equal((await f.claims())[0].state, 'finished');
  f.fixture.reply = async () => Response.json({ id: 'fixture-email' });
  await f.run(); assert.ok(await f.marker()); assert.equal(f.calls.length, 2);
});

test('timeout, rate limit, conflict, server error and malformed success preserve uncertainty without retry', async t => {
  for (const status of ['throw', 408, 409, 429, 500, 200]) {
    await t.test(String(status), async t => {
      const f = setup(t);
      f.fixture.reply = async () => {
        if (status === 'throw') throw Error('private provider diagnostic');
        return Response.json({ unexpected: true }, { status });
      };
      await f.run(); await f.run();
      assert.equal(f.calls.length, 1); assert.ok(await f.marker());
      assert.equal((await f.claims())[0].state, 'uncertain');
      await beginDeletionAdmission(f.env, {origin:'user_request', uid: 'owner' });
      await assert.rejects(assertDeletionQuiescent(f.env, 'owner'), /deletion_operations_pending/);
    });
  }
});

test('settlement failure retains an active operation and prevents automatic resend', async t => {
  const f = setup(t);
  f.db.exec("CREATE TRIGGER fail_settlement BEFORE UPDATE ON account_operation_claims BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await f.run(); await f.run();
  assert.equal(f.calls.length, 1); assert.equal((await f.claims())[0].state, 'active');
  await beginDeletionAdmission(f.env, {origin:'user_request', uid: 'owner' });
  await assert.rejects(assertDeletionQuiescent(f.env, 'owner'), /deletion_operations_pending/);
});

test('a conversion or changed email after selection invalidates the stale candidate', async t => {
  for (const change of ["plan='monthly',has_ever_paid=1", "email='different@example.test'"]) {
    await t.test(change, async t => {
      const f = setup(t), originalPrepare = f.db.prepare;
      f.db.prepare = sql => {
        const stmt = originalPrepare(sql);
        if (sql.includes('SELECT u.id, u.auth_id')) {
          const all = stmt.all;
          stmt.all = async function () { const result = await all.call(this); f.db.exec(`UPDATE users SET ${change}`); return result; };
        }
        return stmt;
      };
      await f.run(); assert.equal(f.calls.length, 0); assert.equal(await f.marker(), null);
      assert.equal((await f.claims())[0].state, 'finished');
    });
  }
});

test('legacy UID tombstones suppress sends and stale-session updates even with a users row', async t => {
  const f = setup(t);
  f.db.exec("INSERT INTO deleted_auth_ids(auth_id) VALUES('owner'); INSERT INTO voice_sessions(id,user_id,status,started_at) VALUES('stale',1,'active',datetime('now','-2 hours'));");
  await worker.scheduled({}, f.env, {});
  assert.equal(f.calls.length, 0);
  assert.equal(await f.db.prepare("SELECT status FROM voice_sessions WHERE id='stale'").first('status'), 'active');
});

test('housekeeping updates only eligible accounts and never writes after their deletion intent', async t => {
  const f = setup(t);
  f.env.VOICE_INTERVIEW_ENABLED = 'false';
  f.db.exec("INSERT INTO users(id,auth_id,email) VALUES(2,'other','other@example.test'); INSERT INTO voice_sessions(id,user_id,status,started_at) VALUES('held',1,'active',datetime('now','-2 hours')),('eligible',2,'created',datetime('now','-2 hours'));");
  await beginDeletionAdmission(f.env, {origin:'user_request', uid: 'owner' });
  await worker.scheduled({}, f.env, {});
  assert.equal(await f.db.prepare("SELECT status FROM voice_sessions WHERE id='held'").first('status'), 'active');
  assert.equal(await f.db.prepare("SELECT status FROM voice_sessions WHERE id='eligible'").first('status'), 'abandoned');
  assert.equal(f.calls.length, 0);
});

test('missing migration, missing credentials, bad destination and dev cutover do not send', async t => {
  const f = setup(t);
  delete f.env.RESEND_API_KEY;
  await f.run(); assert.equal(await f.marker(), null);
  f.env.RESEND_API_KEY = 'fixture-only'; f.env.FRONTEND_URL = 'https://foreign.example';
  await f.run(); assert.equal(await f.marker(), null);
  f.env.FRONTEND_URL = 'https://qa.jobhackai.io';
  f.env.ENVIRONMENT = 'dev'; f.env.DEV_CUTOVER_PAUSED = 'true';
  await worker.scheduled({}, f.env, {}); assert.equal(await f.marker(), null);
  delete f.env.DEV_CUTOVER_PAUSED;
  f.db.exec('DROP TABLE account_deletion_admissions');
  await assert.rejects(f.run(), /no such table/);
  await worker.scheduled({}, f.env, {});
  assert.equal(f.calls.length, 0); assert.equal(await f.marker(), null);
});

test('reconciled uncertain follow-up is not resent even if its marker is reset',async t=>{
  const f=setup(t);f.fixture.reply=async()=>{throw Error('fixture_timeout');};await f.run();
  const claim=(await f.claims())[0];assert.equal(claim.purpose,'followup');assert.equal(claim.state,'uncertain');
  const row=await f.db.prepare(inspectionSql(claim.id)).first(),now=Date.now(),report=inspectReport('qa',row,now);
  report.disposition='suppress_delivery';
  report.evidence={operatorRef:'fixture-operator',invocation:{status:'completed',executionToken:claim.id,observedAt:new Date(now).toISOString(),reference:'fixture/returned-invocation'},
    providers:{status:'settled_unknown',pendingRequests:false,observedAt:new Date(now).toISOString(),reference:'fixture/intercepted-provider'}};
  await f.db.prepare(planReconciliation(report,row,'qa',now).sql).run();

  f.db.exec('UPDATE users SET voice_followup_email_sent_at=NULL');
  await f.run();assert.equal(f.calls.length,1);assert.equal((await f.claims())[0].state,'finished');
});
