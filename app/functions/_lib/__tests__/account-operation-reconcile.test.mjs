import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sqliteD1} from './sqlite-d1-helper.mjs';
import {admitAccountOperation,settleAccountOperation,beginDeletionAdmission,assertDeletionQuiescent} from '../account-deletion-admission.js';
import {inspectionSql,inspectReport,planReconciliation} from '../../../scripts/lib/account-operation-reconcile-core.mjs';
import {run,parseArgs} from '../../../scripts/deletion-execution-reconcile.mjs';
const NOW=Date.parse('2026-09-20T12:00:00Z');
function setup(t) {
  const db=sqliteD1();t.after(()=>db.close());
  db.exec(readFileSync(new URL('../../../db/schema.sql',import.meta.url),'utf8'));
  for(const name of ['024_collected_payments','025_checkout_attribution','026_payment_campaign_links','027_analytics_delivery','028_account_deletion_recovery'])db.exec(readFileSync(new URL('../../../db/migrations/'+name+'.sql',import.meta.url),'utf8'));
  db.exec(`INSERT INTO users(id,auth_id,email) VALUES(1,'owner','private@example.test');
    INSERT INTO stripe_collected_payments(charge_id,payment_intent_id,customer_id,environment,livemode,currency,amount_captured,charge_created_at,first_event_id,last_event_id)
      VALUES('ch_test','pi_test','cus_test','qa',0,'usd',3900,100,'evt_test','evt_test');
    INSERT INTO checkout_attributions(checkout_session_id,user_id,client_id,stripe_customer_id,environment,captured_at,expires_at)
      VALUES('cs_test',1,'browser','cus_test','qa',100,9999999999999);
    INSERT INTO analytics_delivery(event_key,charge_id,checkout_session_id,event_name,event_at,state,created_at,updated_at)
      VALUES('purchase:ch_test','ch_test','cs_test','purchase',100,'uncertain',100,100);`);
  t.mock.method(globalThis,'fetch',()=>assert.fail('Reconciliation must never contact a provider'));
  const env={DB:db};
  const add=async(purpose,kind='account',options={})=>{
    const claim=await admitAccountOperation(env,'owner',kind,{purpose,...options});
    await db.prepare("UPDATE account_operation_claims SET state='uncertain',created_at='2026-09-20 10:00:00',updated_at='2026-09-20 11:00:00' WHERE id=?").bind(claim.id).run();
    return claim;
  };
  return {db,env,add,read:id=>db.prepare(inspectionSql(id)).first(),
    audits:()=>db.prepare('SELECT * FROM account_operation_reconciliations').all().then(r=>r.results),
    apply:async(claim,disposition='verified',status='settled')=>{
      const current=await db.prepare(inspectionSql(claim.id)).first();const report=reviewed(current,disposition,status);
      const plan=planReconciliation(report,current,'qa',NOW);await db.prepare(plan.sql).run();return plan;
    }};
}
function reviewed(row,disposition='verified',status='settled') {
  const report=inspectReport('qa',row,NOW);report.disposition=disposition;
  report.evidence={operatorRef:'fixture-operator',
    invocation:{status:'terminated',executionToken:row.id,observedAt:'2026-09-20T11:50:00Z',reference:'fixture/invocation'},
    providers:{status,pendingRequests:false,observedAt:'2026-09-20T11:55:00Z',reference:'fixture/effects'}};
  return report;
}
test('verified API and webhook work can release deletion after recorded review without changing money',async t=>{
  const f=setup(t),api=await f.add('api','billing'),webhook=await f.add('webhook','billing',{webhookEventId:'evt_test'});
  await beginDeletionAdmission(f.env,{uid:'owner',origin:'user_request'});
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
  await f.apply(api);await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
  await f.apply(webhook);await assertDeletionQuiescent(f.env,'owner');
  assert.equal((await f.audits()).length,2);assert.equal(await f.db.prepare('SELECT amount_captured FROM stripe_collected_payments').first('amount_captured'),3900);
  assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM account_deletion_jobs').first('n'),0);
});
test('a stopped retention pass may release maintenance for the normal idempotent retry, without claiming cleanup complete',async t=>{
  const f=setup(t),claim=await f.add('retention','maintenance');
  await assert.rejects(admitAccountOperation(f.env,'owner'),/operation_busy/);
  await f.apply(claim,'retry_storage','storage_only');
  const ordinary=await admitAccountOperation(f.env,'owner');await settleAccountOperation(f.env,ordinary,'finished');
  assert.equal((await f.audits())[0].disposition,'retry_storage');assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM users').first('n'),1);
});
test('financial operations cannot use delivery suppression or storage-only evidence to hide unresolved effects',async t=>{
  const f=setup(t),claim=await f.add('api','billing'),row=await f.read(claim.id);
  for(const [disposition,status] of [['suppress_delivery','settled_unknown'],['retry_storage','storage_only'],['verified','settled_unknown'],['verified','storage_only']])
    assert.throws(()=>planReconciliation(reviewed(row,disposition,status),row,'qa',NOW),/disposition_invalid|evidence_required/);
  assert.equal((await f.read(claim.id)).state,'uncertain');assert.equal((await f.audits()).length,0);
});
test('suppressed Analytics retains uncertainty and permanently prevents a reset outbox from recollecting the event',async t=>{
  const f=setup(t),claim=await f.add('analytics','account',{analyticsEventKey:'purchase:ch_test'});
  await f.apply(claim,'suppress_delivery','settled_unknown');
  const delivery=await f.db.prepare('SELECT * FROM analytics_delivery').first();assert.equal(delivery.state,'uncertain');assert.equal(delivery.verified_at,null);
  f.db.exec("UPDATE analytics_delivery SET state='pending';DELETE FROM account_operation_claims");
  for(const uid of ['owner','foreign-owner'])await assert.rejects(admitAccountOperation(f.env,uid,'account',{analyticsEventKey:'purchase:ch_test'}),/delivery_suppressed/);
  const other=await admitAccountOperation(f.env,'owner','account',{analyticsEventKey:'refund:re_other'});assert.equal(other.purpose,'analytics');
  assert.equal(await f.db.prepare('SELECT amount_captured FROM stripe_collected_payments').first('amount_captured'),3900);
});
test('accepted Analytics remains accepted-unverified and a reconciliation cannot authorize replay or fabricate GA verification',async t=>{
  const f=setup(t),claim=await f.add('analytics','account',{analyticsEventKey:'purchase:ch_test'});
  let row=await f.read(claim.id);assert.throws(()=>planReconciliation(reviewed(row),row,'qa',NOW),/delivery_not_verified/);
  f.db.exec("UPDATE analytics_delivery SET state='accepted_unverified'");await f.apply(claim);
  assert.equal(await f.db.prepare('SELECT verified_at FROM analytics_delivery').first('verified_at'),null);
  f.db.exec("UPDATE analytics_delivery SET state='pending'");
  await assert.rejects(admitAccountOperation(f.env,'owner','account',{analyticsEventKey:'purchase:ch_test'}),/delivery_suppressed/);
});
test('suppressed follow-up remains suppressed after a manual marker reset, while ordinary account work resumes',async t=>{
  const f=setup(t),claim=await f.add('followup');await f.apply(claim,'suppress_delivery','settled_unknown');
  assert.ok(await f.db.prepare('SELECT voice_followup_email_sent_at FROM users').first('voice_followup_email_sent_at'));
  f.db.exec('UPDATE users SET voice_followup_email_sent_at=NULL');
  await assert.rejects(admitAccountOperation(f.env,'owner','account',{purpose:'followup'}),/operation_suppressed/);
  assert.ok(await admitAccountOperation(f.env,'owner'));
});
test('inactivity suppression does not start a notice period or block an explicit deletion request',async t=>{
  const f=setup(t),claim=await f.add('inactivity','maintenance');
  await f.db.prepare("INSERT INTO account_inactivity_warnings(id,auth_id,email,state,operation_id) VALUES('warning','owner','private@example.test','sending',?)").bind(claim.id).run();
  await f.apply(claim,'suppress_delivery','settled_unknown');
  assert.equal(await f.db.prepare('SELECT state FROM account_inactivity_warnings').first('state'),'needs_review');
  assert.equal(await f.db.prepare('SELECT deletion_warning_sent_at FROM users').first('deletion_warning_sent_at'),null);
  await assert.rejects(admitAccountOperation(f.env,'owner','maintenance',{purpose:'inactivity'}),/operation_suppressed/);
  await beginDeletionAdmission(f.env,{uid:'owner',origin:'user_request'});await assertDeletionQuiescent(f.env,'owner');
});
for(const sql of ["UPDATE account_operation_claims SET state='finished'","UPDATE account_operation_claims SET purpose='api'",
  "UPDATE account_operation_claims SET updated_at='2026-09-20 11:59:00'","UPDATE users SET voice_followup_email_sent_at='2026-09-20 11:58:00'",
  "UPDATE users SET auth_id='changed-owner'"])test(`atomic snapshot rejects concurrent change: ${sql}`,async t=>{
  const f=setup(t),claim=await f.add('followup'),row=await f.read(claim.id),plan=planReconciliation(reviewed(row,'suppress_delivery','settled_unknown'),row,'qa',NOW);
  f.db.exec(sql);const before=await f.read(claim.id);await assert.rejects(f.db.prepare(plan.sql).run());
  assert.deepEqual(await f.read(claim.id),before);assert.equal((await f.audits()).length,0);
});
test('suppression and hold settlement roll back together if updating the marker fails',async t=>{
  const f=setup(t),claim=await f.add('followup');
  f.db.exec("CREATE TRIGGER reject_marker BEFORE UPDATE OF voice_followup_email_sent_at ON users BEGIN SELECT RAISE(ABORT,'fixture_failure'); END;");
  await assert.rejects(f.apply(claim,'suppress_delivery','settled_unknown'));
  assert.equal((await f.read(claim.id)).state,'uncertain');assert.equal((await f.audits()).length,0);
});
test('replay and overlapping plans cannot settle an operation twice',async t=>{
  const f=setup(t),claim=await f.add('api'),row=await f.read(claim.id),report=reviewed(row);
  const a=planReconciliation(report,row,'qa',NOW),b=planReconciliation(report,row,'qa',NOW);
  await f.db.prepare(a.sql).run();await assert.rejects(f.db.prepare(b.sql).run());await assert.rejects(f.db.prepare(a.sql).run());
  assert.equal((await f.audits()).length,1);
});
test('missing or live execution evidence, wrong target and missing delivery receipts refuse release',async t=>{
  const f=setup(t),claim=await f.add('inactivity','maintenance'),row=await f.read(claim.id);
  assert.throws(()=>planReconciliation(reviewed(row),row,'qa',NOW),/delivery_not_verified/);
  const report=reviewed(row,'suppress_delivery','settled_unknown');report.evidence.invocation.status='running';
  assert.throws(()=>planReconciliation(report,row,'qa',NOW),/evidence_required/);
  report.evidence=null;assert.throws(()=>planReconciliation(report,row,'qa',NOW),/evidence_required/);
  assert.throws(()=>planReconciliation(reviewed(row),row,'dev',NOW),/target_mismatch/);
});
test('CLI operation mode is exclusive, private and supports apply receipt lookup against real SQLite',async t=>{
  const f=setup(t),claim=await f.add('followup'),row=await f.read(claim.id),dir=mkdtempSync(join(tmpdir(),'operation-review-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const review=join(dir,'review.json');writeFileSync(review,JSON.stringify(reviewed(row,'suppress_delivery','settled_unknown')));
  const args=parseArgs(['--env=qa','--operation='+claim.id,'--review='+review,'--report='+join(dir,'apply.json'),'--apply']);
  assert.throws(()=>parseArgs(['--env=qa','--job=job','--operation=operation','--report=/tmp/test']));
  const query=async(env,sql)=>(await f.db.prepare(sql).all()).results;
  const result=await run(args,{query,now:()=>NOW});assert.equal(result.operationId,claim.id);assert.equal(result.mode,'applied');
  const receipt=await run({env:'qa',operation:claim.id,receipt:result.id,report:join(dir,'receipt.json')},{query});assert.equal(receipt.found,true);
  const report=inspectReport('qa',row,NOW);assert.equal(JSON.stringify(report).includes('private@example.test'),false);
});
test('purpose and operation kind cannot be mislabeled to evade reconciliation policy',async t=>{
  const f=setup(t);
  for(const [kind,options] of [['billing',{purpose:'followup'}],['maintenance',{purpose:'retention',analyticsEventKey:'purchase:ch_test'}],
    ['account',{purpose:'analytics'}],['billing',{purpose:'api',webhookEventId:'evt_test'}],['account',{purpose:'__proto__'}]])
    await assert.rejects(admitAccountOperation(f.env,'owner',kind,options));
  assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM account_operation_claims').first('n'),0);
});
