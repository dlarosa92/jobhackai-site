import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beginDeletionAdmission, admitAccountOperation, settleAccountOperation } from '../account-deletion-admission.js';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { prepareDeletionRecovery, advanceDeletionRecovery, finishDeletionRecovery } from '../account-deletion-recovery.js';

function setup(t) {
  const db = sqliteD1(); t.after(() => db.close());
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, auth_id TEXT UNIQUE, email TEXT);
    INSERT INTO users VALUES(1,'owner','owner@example.test'),(2,'other','other@example.test');
    CREATE TABLE resume_sessions(id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,raw_text_location TEXT);
    INSERT INTO resume_sessions VALUES('resume-one',1,'raw:one'),('resume-other',2,'raw:other');
    CREATE TABLE feedback_sessions(id TEXT PRIMARY KEY,resume_session_id TEXT REFERENCES resume_sessions(id) ON DELETE CASCADE);
    INSERT INTO feedback_sessions VALUES('feedback-one','resume-one'),('feedback-other','resume-other');
    CREATE TABLE deleted_auth_ids(auth_id TEXT PRIMARY KEY,email TEXT,deleted_at TEXT);
    CREATE TABLE checkout_attributions(checkout_session_id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE);
    INSERT INTO checkout_attributions VALUES('cs_one',1),('cs_other',2);
    CREATE TABLE stripe_collected_payments(charge_id TEXT PRIMARY KEY,amount_captured INTEGER);
    INSERT INTO stripe_collected_payments VALUES('ch_one',3900);
    CREATE TABLE stripe_payment_refunds(refund_id TEXT PRIMARY KEY,charge_id TEXT REFERENCES stripe_collected_payments(charge_id),amount INTEGER);
    INSERT INTO stripe_payment_refunds VALUES('re_one','ch_one',100);
    CREATE TABLE stripe_payment_attributions(charge_id TEXT PRIMARY KEY REFERENCES stripe_collected_payments(charge_id),checkout_session_id TEXT REFERENCES checkout_attributions(checkout_session_id) ON DELETE CASCADE);
    INSERT INTO stripe_payment_attributions VALUES('ch_one','cs_one');
    CREATE TABLE analytics_delivery(event_key TEXT PRIMARY KEY,checkout_session_id TEXT REFERENCES checkout_attributions(checkout_session_id) ON DELETE CASCADE);
    INSERT INTO analytics_delivery VALUES('purchase:ch_one','cs_one');
  `);
  for (const table of ['linkedin_runs','role_usage_log','cover_letter_history']) {
    db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,user_id TEXT);
      INSERT INTO ${table} VALUES('one','owner'),('other','other');`);
  }
  for (const table of ['feature_daily_usage','cookie_consents','usage_events','interview_question_sets','mock_interview_sessions','mock_interview_usage','first_resume_snapshots','voice_sessions']) {
    db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE);
      INSERT INTO ${table} VALUES('one',1),('other',2);`);
  }
  db.exec(readFileSync(new URL('../../../db/migrations/028_account_deletion_recovery.sql', import.meta.url), 'utf8'));
  const deleted=[];
  const env={JOBHACKAI_DB:db,JOBHACKAI_KV:{delete:async key=>deleted.push(key)}};
  return {db,env,deleted,
    row:id=>db.prepare('SELECT * FROM account_deletion_jobs WHERE id = ?').bind(id).first(),
    count:table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n'),
    prepare:async()=>{await beginDeletionAdmission(env,{uid:'owner',email:'token@example.test'});return prepareDeletionRecovery(env,{uid:'owner',email:'token@example.test'});}};
}
async function ready(f) {
  const job=await f.prepare();
  await advanceDeletionRecovery(f.env,job.id,'billing_verified');
  await advanceDeletionRecovery(f.env,job.id,'identity_removed');
  return job;
}

test('manifest is durable and repeated creation retains the original references',async t=>{
  const f=setup(t),job=await f.prepare();
  assert.equal(job.phase,'prepared');assert.equal(job.email,'owner@example.test');
  assert.ok(JSON.parse(job.kv_keys_json).includes('raw:one'));
  assert.ok(JSON.parse(job.kv_keys_json).includes('planByUid:owner'));
  f.db.exec("DELETE FROM resume_sessions WHERE user_id=1");
  const again=await f.prepare();assert.equal(again.id,job.id);
  assert.ok(JSON.parse(again.kv_keys_json).includes('raw:one'));
  assert.deepEqual(f.deleted,[]);
});
test('missing recovery schema fails before any external cleanup',async t=>{
  const f=setup(t);f.db.exec('DROP TABLE account_deletion_jobs');
  await assert.rejects(f.prepare());assert.deepEqual(f.deleted,[]);assert.equal(await f.count('users'),2);
});
test('cleanup refuses unconfirmed identity and invalid phase jumps',async t=>{
  const f=setup(t),job=await f.prepare();
  await assert.rejects(advanceDeletionRecovery(f.env,job.id,'identity_removed'),/transition_conflict/);
  await assert.rejects(advanceDeletionRecovery(f.env,job.id,'complete'),/transition_invalid/);
  await assert.rejects(finishDeletionRecovery(f.env,job.id),/identity_unconfirmed/);
  await advanceDeletionRecovery(f.env,job.id,'billing_verified');
  await assert.rejects(finishDeletionRecovery(f.env,job.id),/identity_unconfirmed/);
  assert.deepEqual(f.deleted,[]);assert.equal(await f.count('users'),2);
});
test('complete cleanup erases content and attribution but retains financial history and other users',async t=>{
  const f=setup(t),job=await ready(f);
  assert.deepEqual(await finishDeletionRecovery(f.env,job.id),{complete:true,alreadyComplete:false});
  for(const table of ['users','resume_sessions','feedback_sessions','voice_sessions','linkedin_runs','checkout_attributions'])assert.equal(await f.count(table),1,table);
  assert.equal(await f.count('stripe_payment_attributions'),0);assert.equal(await f.count('analytics_delivery'),0);
  assert.equal(await f.count('stripe_collected_payments'),1);assert.equal(await f.count('stripe_payment_refunds'),1);
  assert.equal(await f.db.prepare('SELECT auth_id FROM users').first('auth_id'),'other');
  assert.ok(f.deleted.includes('raw:one'));assert.ok(!f.deleted.includes('raw:other'));
  const stored=await f.row(job.id);assert.equal(stored.phase,'complete');assert.equal(stored.email,null);assert.equal(stored.kv_keys_json,'[]');assert.ok(stored.completed_at);
  const n=f.deleted.length;assert.equal((await finishDeletionRecovery(f.env,job.id)).alreadyComplete,true);assert.equal(f.deleted.length,n);
});
test('individual billing-cache failure stays pending with all SQL references and succeeds on retry',async t=>{
  const f=setup(t),job=await ready(f);
  const remove=f.env.JOBHACKAI_KV.delete;
  f.env.JOBHACKAI_KV.delete=async key=>{if(key==='planByUid:owner')throw Error('synthetic private provider failure');await remove(key);};
  await assert.rejects(finishDeletionRecovery(f.env,job.id));
  const pending=await f.row(job.id);assert.equal(pending.phase,'identity_removed');assert.equal(pending.last_error_code,'cleanup_cache_failed');
  assert.ok(JSON.parse(pending.kv_keys_json).includes('raw:one'));assert.equal(await f.count('users'),2);assert.equal(await f.count('resume_sessions'),2);
  f.env.JOBHACKAI_KV.delete=remove;await finishDeletionRecovery(f.env,job.id);
  assert.equal((await f.row(job.id)).phase,'complete');assert.equal(await f.count('users'),1);
});
test('database failure rolls back every table and completion; persisted manifest supports retry after KV deletion',async t=>{
  const f=setup(t),job=await ready(f);
  f.db.exec("CREATE TRIGGER deny_voice_delete BEFORE DELETE ON voice_sessions BEGIN SELECT RAISE(ABORT,'fixture database interruption'); END;");
  await assert.rejects(finishDeletionRecovery(f.env,job.id));
  for(const table of ['users','linkedin_runs','resume_sessions','voice_sessions','checkout_attributions'])assert.equal(await f.count(table),2,table);
  const pending=await f.row(job.id);assert.equal(pending.phase,'identity_removed');assert.equal(pending.last_error_code,'cleanup_database_failed');
  assert.ok(f.deleted.includes('raw:one'));assert.ok(JSON.parse(pending.kv_keys_json).includes('raw:one'));
  f.db.exec('DROP TRIGGER deny_voice_delete');await finishDeletionRecovery(f.env,job.id);
  assert.equal((await f.row(job.id)).phase,'complete');assert.equal(await f.count('users'),1);
});
test('tombstone failure leaves KV and data untouched',async t=>{
  const f=setup(t),job=await ready(f);f.db.exec('DROP TABLE deleted_auth_ids');
  await assert.rejects(finishDeletionRecovery(f.env,job.id));assert.deepEqual(f.deleted,[]);
  assert.equal(await f.count('users'),2);assert.equal((await f.row(job.id)).last_error_code,'cleanup_tombstone_failed');
});
test('late resume references are saved before a failing deletion and remain recoverable',async t=>{
  const f=setup(t),job=await ready(f);
  f.db.exec("INSERT INTO resume_sessions VALUES('late',1,'raw:late')");
  f.env.JOBHACKAI_KV.delete=async()=>{throw Error('offline');};
  await assert.rejects(finishDeletionRecovery(f.env,job.id));
  const keys=JSON.parse((await f.row(job.id)).kv_keys_json);assert.ok(keys.includes('raw:late'));assert.ok(keys.includes('resume:late'));
});
test('owner reassignment is refused before cleanup, including a race at the final transaction',async t=>{
  const f=setup(t),job=await ready(f);
  f.db.exec("UPDATE users SET auth_id='reassigned' WHERE id=1");
  await assert.rejects(finishDeletionRecovery(f.env,job.id),/identity_conflict/);assert.deepEqual(f.deleted,[]);
  f.db.exec("UPDATE users SET auth_id='owner' WHERE id=1");
  let changed=false;
  f.env.JOBHACKAI_KV.delete=async()=>{if(!changed){changed=true;f.db.exec("UPDATE users SET auth_id='reassigned' WHERE id=1");}};
  await assert.rejects(finishDeletionRecovery(f.env,job.id),/NOT NULL/);
  assert.equal(await f.count('users'),2);assert.equal(await f.count('voice_sessions'),2);assert.equal((await f.row(job.id)).phase,'identity_removed');
});
test('Firebase-only jobs clean UID data without deleting a different database account',async t=>{
  const f=setup(t);
  await beginDeletionAdmission(f.env,{uid:'firebase-only',email:'only@example.test'});
  const job=await prepareDeletionRecovery(f.env,{uid:'firebase-only',email:'only@example.test'});
  assert.equal(job.user_id,null);await advanceDeletionRecovery(f.env,job.id,'billing_verified');await advanceDeletionRecovery(f.env,job.id,'identity_removed');
  await finishDeletionRecovery(f.env,job.id);assert.equal(await f.count('users'),2);assert.equal(await f.count('voice_sessions'),2);
});

test('repository schema and migrations support the erasure transaction and attribution cascades',async t=>{
  const db=sqliteD1();t.after(()=>db.close());
  const sql=name=>readFileSync(new URL('../../../db/'+name,import.meta.url),'utf8');
  db.exec(sql('schema.sql'));
  for(const name of ['002_add_feature_daily_usage','006_linkedin_runs','008_add_cookie_consents','009_role_templates','024_collected_payments','025_checkout_attribution','026_payment_campaign_links','027_analytics_delivery','028_account_deletion_recovery']) {
    db.exec(sql('migrations/'+name+'.sql'));
  }
  const coverSource=readFileSync(new URL('../../api/cover-letter/generate.js',import.meta.url),'utf8');
  const coverSql=coverSource.match(/`(CREATE TABLE IF NOT EXISTS cover_letter_history[\s\S]+?)`/)[1];
  db.exec(coverSql);
  db.exec(`
    INSERT INTO users(id,auth_id,email) VALUES(1,'owner','fixture@example.test'),(2,'other','other@example.test');
    INSERT INTO voice_sessions(id,user_id,transcript_json,scorecard_json) VALUES('voice-one',1,'private transcript','private report'),('voice-other',2,'other transcript','other report');
    INSERT INTO checkout_attributions(checkout_session_id,user_id,client_id,stripe_customer_id,environment,captured_at,expires_at)
      VALUES('cs_one',1,'client_fixture','cus_fixture','qa',1,9999999999999);
    INSERT INTO stripe_collected_payments(charge_id,payment_intent_id,customer_id,environment,livemode,currency,amount_captured,charge_created_at,first_event_id,last_event_id)
      VALUES('ch_one','pi_fixture','cus_fixture','qa',0,'usd',3900,1,'evt_one','evt_one');
    INSERT INTO stripe_payment_refunds(refund_id,charge_id,currency,amount,status,refund_created_at,last_event_id)
      VALUES('re_one','ch_one','usd',100,'succeeded',1,'evt_refund');
    INSERT INTO stripe_payment_attributions(charge_id,checkout_session_id,linked_at) VALUES('ch_one','cs_one',1);
    INSERT INTO analytics_delivery(event_key,charge_id,checkout_session_id,event_name,event_at,created_at,updated_at)
      VALUES('purchase:ch_one','ch_one','cs_one','purchase',1,1,1);
  `);
  const env={JOBHACKAI_DB:db,JOBHACKAI_KV:{delete:async()=>{}}};
  await beginDeletionAdmission(env,{uid:'owner'});
  const job=await prepareDeletionRecovery(env,{uid:'owner'});
  await advanceDeletionRecovery(env,job.id,'billing_verified');await advanceDeletionRecovery(env,job.id,'identity_removed');
  await finishDeletionRecovery(env,job.id);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM voice_sessions').first('n'),1);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM analytics_delivery').first('n'),0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM stripe_collected_payments').first('n'),1);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM stripe_payment_refunds').first('n'),1);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('recovery cannot prepare until the intent exists and earlier operations finish',async t=>{
 const f=setup(t);
 await assert.rejects(prepareDeletionRecovery(f.env,{uid:'owner'}),/admission_required/);
 const claim=await admitAccountOperation(f.env,'owner','billing');
 await assert.rejects(f.prepare(),/operations_pending/);
 assert.equal(await f.count('account_deletion_jobs'),0);
 await settleAccountOperation(f.env,claim,'finished');
 const job=await ready(f);await finishDeletionRecovery(f.env,job.id);
 const admission=await f.db.prepare("SELECT * FROM account_deletion_admissions WHERE auth_id='owner'").first();
 assert.equal(admission.state,'complete');assert.equal(admission.email,null);
 assert.equal(await f.count('account_operation_claims'),0);
 await assert.rejects(admitAccountOperation(f.env,'owner'),/deletion_pending/);
});
