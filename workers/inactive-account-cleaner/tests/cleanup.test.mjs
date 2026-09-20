import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync,webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { sqliteD1 } from '../../../app/functions/_lib/__tests__/sqlite-d1-helper.mjs';
import { admitAccountOperation,beginDeletionAdmission,assertDeletionQuiescent } from '../../../app/functions/_lib/account-deletion-admission.js';
import { prepareDeletionRecovery,advanceDeletionRecovery } from '../../../app/functions/_lib/account-deletion-recovery.js';
import { runInactiveAccountCleanup as runSource,default as sourceWorker } from '../src/index.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const compiled=process.env.JOBHACKAI_INACTIVE_BUNDLE;
const implementation=compiled?await import(pathToFileURL(compiled).href):null;
const run=compiled?implementation.runInactiveAccountCleanup:runSource;
if(typeof run!=='function')throw Error('Compiled inactivity entry point is missing');
const worker=implementation?.default || sourceWorker;
const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const credentials=JSON.stringify({project_id:'fixture-project',client_email:'fixture@fixture-project.iam.gserviceaccount.com',private_key:key});

function setup(t) {
  const db=sqliteD1();t.after(()=>db.close());
  const sql=name=>readFileSync(new URL('../../../app/db/'+name,import.meta.url),'utf8');
  db.exec(sql('schema.sql'));
  for(const name of ['002_add_feature_daily_usage','006_linkedin_runs','008_add_cookie_consents','009_role_templates',
    '024_collected_payments','025_checkout_attribution','026_payment_campaign_links','027_analytics_delivery','028_account_deletion_recovery']) db.exec(sql('migrations/'+name+'.sql'));
  const cover=readFileSync(new URL('../../../app/functions/api/cover-letter/generate.js',import.meta.url),'utf8');
  db.exec(cover.match(/`(CREATE TABLE IF NOT EXISTS cover_letter_history[\s\S]+?)`/)[1]);
  db.exec("INSERT INTO users(id,auth_id,email,last_login_at) VALUES(1,'owner','owner@example.test','2020-01-01 00:00:00')");
  const deleted=new Set(),calls=[],kvDeletes=[];
  const state={outcome:'accepted',paid:false,refresh:null,onSend:null,billingFails:false};
  const env={JOBHACKAI_DB:db,JOBHACKAI_KV:{get:async()=>null,delete:async key=>{kvDeletes.push(key);}},
    ENVIRONMENT:'qa',INACTIVITY_MODE:'execute',INACTIVITY_TEST_UID:'owner',FRONTEND_URL:'https://qa.jobhackai.io',
    FIREBASE_PROJECT_ID:'fixture-project',FIREBASE_SERVICE_ACCOUNT_JSON:credentials,
    STRIPE_SECRET_KEY:'sk_test_fixture_only',RESEND_API_KEY:'fixture_only'};
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    url=String(url);const method=options.method||'GET';calls.push({url,method,body:options.body,headers:options.headers});
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-token'});
    if(url.includes('identitytoolkit.googleapis.com')) {
      const body=JSON.parse(options.body),uid=Array.isArray(body.localId)?body.localId[0]:body.localId;
      if(url.endsWith('accounts:lookup'))return Response.json(deleted.has(uid)?{}:{users:[{localId:uid,lastLoginAt:'1577836800000',...(state.refresh?{lastRefreshAt:state.refresh}:{})}]});
      assert.ok(url.endsWith('accounts:delete'));
      assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM account_operation_claims WHERE auth_id=? AND state<>'finished'").bind(uid).first('n'),0);
      assert.equal(await db.prepare('SELECT phase FROM account_deletion_jobs WHERE auth_id=?').bind(uid).first('phase'),'billing_verified');
      deleted.add(uid);return Response.json({});
    }
    if(url.startsWith('https://api.stripe.com/')) {
      assert.equal(method,'GET','inactivity must never mutate billing');
      if(state.billingFails)return Response.json({error:'fixture'},{status:503});
      const path=new URL(url).pathname;
      if(path==='/v1/customers' && state.paid)return Response.json({data:[{id:'cus_owner',metadata:{firebaseUid:'owner'}}],has_more:false});
      if(path==='/v1/subscriptions' && state.paid)return Response.json({data:[{id:'sub_owner',customer:'cus_owner',status:'active',metadata:{firebaseUid:'owner',environment:env.ENVIRONMENT==='production'?'prod':'qa'}}],has_more:false});
      return Response.json({data:[],has_more:false});
    }
    if(url==='https://api.resend.com/emails') {
      await state.onSend?.();
      if(state.outcome==='timeout')throw Error('fixture private timeout');
      if(state.outcome==='malformed')return Response.json({});
      if(typeof state.outcome==='number')return Response.json({error:'fixture private diagnostic'},{status:state.outcome});
      return Response.json({id:'mail_fixture'});
    }
    throw Error('Unexpected provider request: '+url);
  });
  return {db,env,state,calls,deleted,kvDeletes,
    run:options=>run(env,options),
    count:table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n'),
    sent:()=>calls.filter(call=>call.url==='https://api.resend.com/emails'),
    warning:()=>db.prepare("SELECT * FROM account_inactivity_warnings WHERE auth_id='owner'").first()};
}
function acceptedWarning(f) {
  f.db.exec(`UPDATE users SET deletion_warning_sent_at=datetime('now','-40 days');
    INSERT INTO account_inactivity_warnings(id,auth_id,email,state,provider_id,sent_at)
    SELECT 'notice',auth_id,email,'sent','old_receipt',deletion_warning_sent_at FROM users;`);
}

test('audit is bounded and read-only, and database candidates are not claimed as provider-verified eligibility',async t=>{
  const f=setup(t);delete f.env.INACTIVITY_MODE;delete f.env.INACTIVITY_TEST_UID;
  for(let id=2;id<=7;id++)f.db.exec(`INSERT INTO users(id,auth_id,email,last_login_at) VALUES(${id},'owner${id}','owner${id}@example.test','2020-01-01 00:00:00')`);
  const first=await f.run();assert.equal(first.mode,'audit');assert.equal(first.database_candidates,5);assert.equal(first.next_user_id,5);
  assert.equal(first.eligibility,'provider_checks_not_run');
  const second=await f.run({afterUserId:first.next_user_id});assert.equal(second.database_candidates,2);assert.equal(second.next_user_id,0);
  for(const table of ['account_maintenance_cursors','account_operation_claims','account_inactivity_warnings'])assert.equal(await f.count(table),0);
  assert.equal(f.calls.length,0);assert.equal(f.kvDeletes.length,0);
});
test('scheduled handler saves an accepted warning exactly once while holding exclusive maintenance',async t=>{
  const f=setup(t);let checked=false;
  f.state.onSend=async()=>{
    checked=true;const warning=await f.warning();assert.equal(warning.state,'sending');assert.ok(warning.operation_id);
    assert.equal(await f.db.prepare('SELECT deletion_warning_sent_at FROM users').first('deletion_warning_sent_at'),null);
    await assert.rejects(admitAccountOperation(f.env,'owner'),/operation_busy/);
  };
  const waits=[];await worker.scheduled({},f.env,{waitUntil:promise=>waits.push(promise)});await Promise.all(waits);
  assert.equal(checked,true);const warning=await f.warning();assert.equal(warning.state,'sent');assert.equal(warning.provider_id,'mail_fixture');
  assert.equal(warning.sent_at,await f.db.prepare('SELECT deletion_warning_sent_at FROM users').first('deletion_warning_sent_at'));
  assert.equal(await f.db.prepare('SELECT state FROM account_operation_claims').first('state'),'finished');
  const message=JSON.parse(f.sent()[0].body);assert.match(message.html,/https:\/\/qa\.jobhackai\.io\/login/);
  assert.match(message.html,/no sooner than 30 days/);assert.match(f.sent()[0].headers['Idempotency-Key'],/^inactivity-warning\//);
  await f.run();assert.equal(f.sent().length,1);assert.equal(f.deleted.size,0);
});
test('an eligible warned account creates durable intent and uses the real deletion processor',async t=>{
  const f=setup(t);acceptedWarning(f);const result=await f.run();
  assert.equal(result.completed,1);assert.equal(f.deleted.has('owner'),true);assert.equal(await f.count('users'),0);
  assert.equal(await f.db.prepare('SELECT phase FROM account_deletion_jobs').first('phase'),'complete');
  assert.equal(await f.db.prepare('SELECT origin FROM account_deletion_admissions').first('origin'),'inactivity');
  assert.equal(await f.count('account_deletion_notifications'),1);assert.equal(await f.count('account_inactivity_warnings'),0);
  assert.equal(f.sent().length,0);assert.ok(f.kvDeletes.length>0);
});
test('a missing address cannot be silently marked warned or deleted',async t=>{
  const f=setup(t);f.db.exec('UPDATE users SET email=NULL');await f.run();
  assert.equal(f.sent().length,0);assert.equal(await f.count('account_inactivity_warnings'),0);
  assert.equal(await f.db.prepare('SELECT deletion_warning_sent_at FROM users').first('deletion_warning_sent_at'),null);assert.equal(f.deleted.size,0);
});
test('recent provider activity and actual paid subscriptions suppress notices without repairing D1 plans',async t=>{
  const f=setup(t);f.state.refresh=new Date().toISOString();await f.run();assert.equal(f.sent().length,0);
  f.state.refresh=null;f.state.paid=true;assert.equal((await f.run()).billing_unverified,1);
  assert.equal(f.sent().length,0);assert.equal(await f.db.prepare('SELECT plan FROM users').first('plan'),'free');assert.equal(f.deleted.size,0);
});
for(const outcome of ['timeout','malformed',408,409,429,503])test(`uncertain warning outcome ${outcome} is retained and never automatically resent`,async t=>{
  const f=setup(t);f.state.outcome=outcome;const result=await f.run();assert.equal(result.uncertain,1);
  assert.equal((await f.warning()).state,'needs_review');assert.equal(await f.db.prepare('SELECT state FROM account_operation_claims').first('state'),'uncertain');
  f.db.exec("UPDATE account_inactivity_warnings SET created_at='2000-01-01';UPDATE account_operation_claims SET updated_at='2000-01-01'");
  await f.run();assert.equal(f.sent().length,1);assert.equal(f.deleted.size,0);
  assert.equal(await f.db.prepare('SELECT deletion_warning_sent_at FROM users').first('deletion_warning_sent_at'),null);
});
test('definitive rejection allows at most three attempts with the same key and payload',async t=>{
  const f=setup(t);f.state.outcome=422;for(let i=0;i<4;i++)await f.run();
  assert.equal(f.sent().length,3);assert.equal(new Set(f.sent().map(call=>call.headers['Idempotency-Key'])).size,1);
  assert.equal(new Set(f.sent().map(call=>call.body)).size,1);assert.equal((await f.warning()).state,'needs_review');
  assert.equal(await f.db.prepare("SELECT COUNT(*) AS n FROM account_operation_claims WHERE state<>'finished'").first('n'),0);
  assert.equal(await f.db.prepare('SELECT deletion_warning_sent_at FROM users').first('deletion_warning_sent_at'),null);
});
test('accepted email with failed receipt persistence retains uncertainty without starting the notice clock',async t=>{
  const f=setup(t),batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{if(statements[0].sql.includes('UPDATE account_inactivity_warnings'))throw Error('fixture storage failure');return batch(statements);};
  assert.equal((await f.run()).failed,1);assert.equal((await f.warning()).state,'sending');
  assert.equal(await f.db.prepare('SELECT state FROM account_operation_claims').first('state'),'uncertain');
  assert.equal(await f.db.prepare('SELECT deletion_warning_sent_at FROM users').first('deletion_warning_sent_at'),null);
  await f.run();assert.equal(f.sent().length,1);
});
test('a deletion requested during an earlier email waits for its receipt and then resumes safely',async t=>{
  const f=setup(t);f.state.onSend=async()=>{
    await beginDeletionAdmission(f.env,{uid:'owner',origin:'user_request'});
    await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
  };
  await f.run();assert.equal(f.sent().length,1);assert.equal(f.deleted.size,0);
  assert.equal((await f.run()).completed,1);assert.equal(f.deleted.has('owner'),true);assert.equal(f.sent().length,1);
});
test('saved storage-only recovery does not require provider credentials or repeat identity removal',async t=>{
  const f=setup(t);await beginDeletionAdmission(f.env,{uid:'owner',origin:'user_request'});
  const job=await prepareDeletionRecovery(f.env,{uid:'owner'});await advanceDeletionRecovery(f.env,job.id,'billing_verified');await advanceDeletionRecovery(f.env,job.id,'identity_removed');
  delete f.env.STRIPE_SECRET_KEY;delete f.env.FIREBASE_SERVICE_ACCOUNT_JSON;delete f.env.RESEND_API_KEY;
  assert.equal((await f.run()).completed,1);assert.equal(f.calls.length,0);assert.equal(await f.count('users'),0);
});
test('active or uncertain operations and crashed execution tokens are never taken over',async t=>{
  const f=setup(t);await admitAccountOperation(f.env,'owner');await beginDeletionAdmission(f.env,{uid:'owner',origin:'user_request'});
  await f.run();assert.equal(f.calls.length,0);
  f.db.exec("UPDATE account_operation_claims SET state='finished'");const job=await prepareDeletionRecovery(f.env,{uid:'owner'});
  f.db.exec("UPDATE account_deletion_jobs SET execution_token='crashed',execution_started_at='2000-01-01'");
  await f.run();assert.equal(f.calls.length,0);assert.equal((await f.db.prepare('SELECT phase FROM account_deletion_jobs WHERE id=?').bind(job.id).first()).phase,'prepared');
});
test('nonproduction execution requires a single UID and never touches another account',async t=>{
  const f=setup(t);delete f.env.INACTIVITY_TEST_UID;await assert.rejects(f.run(),/configuration_invalid/);assert.equal(f.calls.length,0);
  f.env.INACTIVITY_TEST_UID='owner';f.db.exec("INSERT INTO users(auth_id,email,last_login_at) VALUES('other','other@example.test','2020-01-01')");
  await beginDeletionAdmission(f.env,{uid:'other',origin:'user_request'});await f.run();
  assert.equal(f.sent().length,1);assert.equal(f.deleted.has('other'),false);assert.equal(await f.count('users'),2);
});
test('unscoped batches advance and wrap a revisioned cursor without resending accepted notices',async t=>{
  const f=setup(t);f.env.ENVIRONMENT='production';f.env.FRONTEND_URL='https://app.jobhackai.io';f.env.STRIPE_SECRET_KEY='sk_live_fixture_only';delete f.env.INACTIVITY_TEST_UID;
  for(let id=2;id<=7;id++)f.db.exec(`INSERT INTO users(id,auth_id,email,last_login_at) VALUES(${id},'owner${id}','owner${id}@example.test','2020-01-01 00:00:00')`);
  const first=await f.run();assert.equal(first.warnings_accepted,5);assert.equal(first.next_user_id,5);
  const second=await f.run();assert.equal(second.warnings_accepted,2);assert.equal(second.next_user_id,0);
  await f.run();assert.equal(f.sent().length,7);assert.equal(await f.db.prepare('SELECT revision FROM account_maintenance_cursors').first('revision'),3);
});
test('a stale overlapping batch cannot overwrite a newer cursor revision',async t=>{
  const f=setup(t);f.env.ENVIRONMENT='production';f.env.FRONTEND_URL='https://app.jobhackai.io';f.env.STRIPE_SECRET_KEY='sk_live_fixture_only';delete f.env.INACTIVITY_TEST_UID;
  f.db.exec("INSERT INTO account_maintenance_cursors(name,last_user_id,revision) VALUES('inactivity',0,1)");
  f.state.onSend=async()=>f.db.exec("UPDATE account_maintenance_cursors SET last_user_id=100,revision=2");
  assert.equal((await f.run()).cursor_advanced,false);assert.equal(await f.db.prepare('SELECT last_user_id FROM account_maintenance_cursors').first('last_user_id'),100);
});
test('paused dev schedules and public HTTP requests cannot perform cleanup',async t=>{
  let waits=0;await worker.scheduled({}, {ENVIRONMENT:'dev',DEV_CUTOVER_PAUSED:'true',get JOBHACKAI_DB(){throw Error('must not read');}}, {waitUntil(){waits++;}});
  assert.equal(waits,0);assert.equal((await worker.fetch(new Request('https://example.test/'))).status,404);
});
test('a scheduled ambiguous send is reported as a failed run requiring review',async t=>{
  const f=setup(t);f.state.outcome='timeout';const waits=[];
  await worker.scheduled({},f.env,{waitUntil:promise=>waits.push(promise)});
  await assert.rejects(Promise.all(waits),/inactivity_batch_requires_review/);
  assert.equal((await f.warning()).state,'needs_review');assert.equal(f.sent().length,1);
});
test('overlapping schedules cannot send a second warning while the first provider call is outstanding',async t=>{
  const f=setup(t);let start,finish;const started=new Promise(resolve=>{start=resolve;}),released=new Promise(resolve=>{finish=resolve;});
  f.state.onSend=async()=>{start();await released;};
  const first=f.run();await started;await f.run();assert.equal(f.sent().length,1);
  finish();assert.equal((await first).warnings_accepted,1);assert.equal(f.sent().length,1);
});
test('activity after an old warning starts a new notice cycle instead of allowing immediate deletion',async t=>{
  const f=setup(t);acceptedWarning(f);
  f.db.exec("UPDATE users SET last_login_at='2021-01-01 00:00:00',deletion_warning_sent_at='2020-06-01 00:00:00';UPDATE account_inactivity_warnings SET sent_at='2020-06-01 00:00:00'");
  const result=await f.run();assert.equal(result.warnings_accepted,1);assert.equal(f.deleted.size,0);
  assert.notEqual((await f.warning()).id,'notice');assert.equal(await f.count('users'),1);
});
test('invalid configuration cannot silently widen a scoped run or select an unknown environment',async t=>{
  const f=setup(t);
  for(const environment of ['sandbox','__proto__','']) {
    f.env.ENVIRONMENT=environment;await assert.rejects(f.run(),/configuration_invalid/);
  }
  f.env.ENVIRONMENT='production';
  for(const scope of [0,false,{},' ']) {
    f.env.INACTIVITY_TEST_UID=scope;await assert.rejects(f.run(),/configuration_invalid/);
  }
  f.env.INACTIVITY_TEST_UID='owner';f.env.INACTIVITY_MODE='delete';await assert.rejects(f.run(),/configuration_invalid/);
  assert.equal(f.calls.length,0);assert.equal(await f.count('account_operation_claims'),0);
});
