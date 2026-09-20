import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sqliteD1} from './sqlite-d1-helper.mjs';
import {calls,legacy} from '../../../scripts/lib/voice-closure-reconcile-core.mjs';
import {run,parseArgs} from '../../../scripts/deletion-execution-reconcile.mjs';
import {openManagedInterview} from '../voice-managed-interview.js';
const NOW=Date.parse('2026-09-20T12:00:00Z'),SESSION='11111111-1111-4111-8111-111111111111',KEY='a'.repeat(64);
function fixture(t,{unknown=false,old=false}={}) {
  const db=sqliteD1();t.after(()=>db.close());
  db.exec(readFileSync(new URL('../../../db/schema.sql',import.meta.url),'utf8'));
  for(const name of ['024_collected_payments','025_checkout_attribution','026_payment_campaign_links','027_analytics_delivery','028_account_deletion_recovery'])db.exec(readFileSync(new URL('../../../db/migrations/'+name+'.sql',import.meta.url),'utf8'));
  db.exec(`INSERT INTO users(id,auth_id,email,free_session_used,voice_sessions_remaining) VALUES(1,'owner','private@example.test',1,4);
    INSERT INTO voice_sessions(id,user_id,status,role,transcript_json) VALUES('${SESSION}',1,'complete','Engineer','private transcript');
    INSERT INTO voice_interview_controls(session_id,auth_id,deadline_at,reserved_at,legacy_unverified,closed_at,created_at,updated_at)
      VALUES('${SESSION}','owner','2026-09-20 11:20:00','2026-09-20 11:00:00',${old?1:0},${old?"'2026-09-20 11:10:00'":'NULL'},'2026-09-20 11:00:00','2026-09-20 11:10:00');`);
  if(!old) db.exec(`INSERT INTO voice_provider_calls(id,auth_id,session_id,state,provider_call_id,provider_key_sha256,execution_token,created_at,updated_at)
    VALUES('attempt','owner','${SESSION}','uncertain',${unknown?'NULL':"'rtc_known'"},'${KEY}','execution','2026-09-20 11:00:00','2026-09-20 11:10:00');
    UPDATE voice_interview_controls SET updated_at='2026-09-20 11:10:00';`);
  const core=old?legacy:calls,id=old?SESSION:'attempt';
  t.mock.method(globalThis,'fetch',()=>assert.fail('Recovery cannot contact any provider'));
  const dir=mkdtempSync(join(tmpdir(),'voice-reconciliation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const read=()=>db.prepare(core.inspectionSql(id)).first();
  return {db,core,id,dir,read,audits:()=>db.prepare('SELECT * FROM voice_closure_reconciliations').all().then(r=>r.results),
    prepare:async()=>{const row=await read(),report=reviewed(core,row,{old,unknown});return {row,report,plan:core.planReconciliation(report,row,'qa',NOW)};}};
}
function reviewed(core,row,{old=false,unknown=false}={}) {
  const report=core.inspectReport('qa',row,NOW);report.resolution=old?'legacy_drained':unknown?'not_created':'closed';
  report.evidence={operatorRef:'fixture/operator',
    invocation:{status:'terminated',executionToken:old?row.id:row.execution_token||row.id,observedAt:'2026-09-20T11:50:00Z',reference:'fixture/invocation'},
    providers:{status:report.resolution,pendingRequests:false,environment:'qa',projectRef:'fixture/project',
      observedAt:'2026-09-20T11:55:00Z',reference:'fixture/provider',
      ...(old?{scope:'environment_legacy_calls',issuersDisabled:true,credentialsDrained:true,allInvocationsTerminal:true}:
        {scope:'one_create_attempt',attemptId:row.id,providerKeySha256:row.provider_key_sha256,providerCallId:row.provider_call_id})}};
  return report;
}
test('verified closure records one receipt, fences startup and preserves credits/report/history',async t=>{
  const f=fixture(t),before=await f.db.prepare('SELECT * FROM voice_sessions').first(),{plan}=await f.prepare();
  await f.db.prepare(plan.sql).run();const row=await f.read();
  assert.equal(row.state,'closed');assert.equal(row.execution_token,null);assert.ok(row.closed_at);
  assert.deepEqual(await f.db.prepare('SELECT * FROM voice_sessions').first(),before);
  assert.deepEqual(await f.db.prepare('SELECT free_session_used,voice_sessions_remaining FROM users').first(),{free_session_used:1,voice_sessions_remaining:4});
  const audit=(await f.audits())[0];assert.equal(audit.evidence_sha256,plan.evidenceHash);assert.equal('email' in audit,false);
  assert.equal(JSON.stringify(audit).includes('private transcript'),false);
  await assert.rejects(openManagedInterview({DB:f.db},{uid:'owner',sessionId:SESSION,sdp:'v=0 offer',role:'Engineer'}),/connection_ended/);
});
test('verified never-created attempts close without inventing a provider ID or refund',async t=>{
  const f=fixture(t,{unknown:true}),{plan}=await f.prepare();await f.db.prepare(plan.sql).run();
  assert.equal((await f.read()).state,'closed');assert.equal((await f.read()).provider_call_id,null);
  assert.equal((await f.audits())[0].resolution,'not_created');
  assert.equal(await f.db.prepare('SELECT voice_sessions_remaining FROM users').first('voice_sessions_remaining'),4);
});
test('an unrecorded call may be associated with its independently verified closed provider reference',async t=>{
  const f=fixture(t,{unknown:true}),row=await f.read(),report=reviewed(calls,row,{unknown:true});
  report.resolution='closed';report.evidence.providers.status='closed';report.evidence.providers.providerCallId='rtc_recovered';
  const plan=calls.planReconciliation(report,row,'qa',NOW);await f.db.prepare(plan.sql).run();
  assert.equal((await f.read()).provider_call_id,'rtc_recovered');assert.equal((await f.read()).state,'closed');
});
test('inventory, unresolved provider outcomes and time alone are never closure evidence',async t=>{
  const f=fixture(t),row=await f.read();
  assert.throws(()=>calls.planReconciliation(calls.inspectReport('qa',row),row,'qa',NOW),/not_releasable/);
  for(const change of [r=>r.evidence.invocation.status='running',r=>r.evidence.invocation.executionToken='different',
    r=>r.evidence.providers.pendingRequests=true,r=>r.evidence.providers.status='unknown',r=>r.evidence.providers.providerCallId='rtc_other',
    r=>r.evidence.providers.attemptId='other',r=>r.evidence.providers.providerKeySha256='b'.repeat(64),
    r=>r.evidence.providers.environment='prod',r=>r.evidence.providers.projectRef='',
    r=>r.evidence.providers.observedAt='2026-09-20T10:00:00Z',r=>r.evidence.providers.observedAt='2026-09-20T12:01:00Z']) {
    const report=reviewed(calls,row);change(report);assert.throws(()=>calls.planReconciliation(report,row,'qa',NOW),/evidence_required/);
  }
  assert.equal((await f.read()).state,'uncertain');assert.equal((await f.audits()).length,0);
});
test('known provider calls cannot be described as never created',async t=>{
  const f=fixture(t),row=await f.read(),report=reviewed(calls,row);report.resolution='not_created';
  report.evidence.providers.status='not_created';report.evidence.providers.providerCallId=null;
  assert.throws(()=>calls.planReconciliation(report,row,'qa',NOW),/provider_evidence_required/);
});
for(const change of ["UPDATE voice_provider_calls SET execution_token='replacement'", "UPDATE voice_provider_calls SET state='closing'",
  "UPDATE voice_provider_calls SET provider_call_id='rtc_changed'", "UPDATE voice_provider_calls SET updated_at='2026-09-20 11:49:00'",
  "UPDATE voice_provider_calls SET last_error_code='new_provider_observation'",
  "UPDATE voice_interview_controls SET current_attempt_id='replacement'", "UPDATE voice_interview_controls SET reserved_at=NULL",
  "UPDATE voice_interview_controls SET auth_id='foreign'", "UPDATE voice_interview_controls SET legacy_unverified=1"]) {
  test('atomic closure refuses changed snapshot: '+change,async t=>{
    const f=fixture(t),{plan}=await f.prepare();f.db.exec(change);const before=await f.read();
    await assert.rejects(f.db.prepare(plan.sql).run());assert.deepEqual(await f.read(),before);assert.equal((await f.audits()).length,0);
  });
}
test('competing applications, replay and audit failure cannot produce a second closure receipt',async t=>{
  const f=fixture(t),{row,report,plan}=await f.prepare(),second=calls.planReconciliation(report,row,'qa',NOW);
  f.db.exec("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON voice_closure_reconciliations BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(f.db.prepare(plan.sql).run());assert.equal((await f.read()).state,'uncertain');
  f.db.exec('DROP TRIGGER fixture_audit_failure');await f.db.prepare(plan.sql).run();
  await assert.rejects(f.db.prepare(second.sql).run());await assert.rejects(f.db.prepare(plan.sql).run());
  assert.equal((await f.audits()).length,1);
});
test('a recovered provider reference already assigned to another attempt rolls back the whole reconciliation',async t=>{
  const f=fixture(t,{unknown:true}),row=await f.read(),report=reviewed(calls,row,{unknown:true});
  f.db.exec(`INSERT INTO voice_provider_calls(id,auth_id,session_id,state,provider_call_id,provider_key_sha256)
    VALUES('other-attempt','other-owner','other-session','closed','rtc_other','${KEY}');`);
  report.resolution='closed';report.evidence.providers.status='closed';report.evidence.providers.providerCallId='rtc_other';
  const plan=calls.planReconciliation(report,row,'qa',NOW);await assert.rejects(f.db.prepare(plan.sql).run());
  assert.equal((await f.read()).state,'uncertain');assert.equal((await f.read()).provider_call_id,null);assert.equal((await f.audits()).length,0);
});
test('closure receipt survives account/control/history erasure and still prevents UUID reuse',async t=>{
  const f=fixture(t),{plan}=await f.prepare();await f.db.prepare(plan.sql).run();
  f.db.exec("DELETE FROM voice_provider_calls;DELETE FROM voice_interview_controls;DELETE FROM voice_sessions;DELETE FROM users;INSERT INTO users(id,auth_id,email) VALUES(2,'new-owner','new@example.test');");
  assert.equal((await f.audits()).length,1);
  await assert.rejects(openManagedInterview({DB:f.db},{uid:'new-owner',sessionId:SESSION,sdp:'v=0 offer',role:'Engineer'}),/connection_ended/);
  assert.equal(await f.db.prepare('SELECT free_session_used FROM users').first('free_session_used'),0);
});
test('legacy holds require verified environment drain and preserve the original End and reservation',async t=>{
  const f=fixture(t,{old:true}),{row,plan}=await f.prepare();await f.db.prepare(plan.sql).run();const after=await f.read();
  assert.equal(after.legacy_unverified,0);assert.equal(after.closed_at,row.closed_at);assert.equal(after.reserved_at,row.reserved_at);
  assert.equal((await f.audits())[0].resolution,'legacy_drained');
});
test('legacy hold refuses incomplete drain proof and newly pending tracked calls',async t=>{
  const f=fixture(t,{old:true}),row=await f.read();
  for(const field of ['issuersDisabled','credentialsDrained','allInvocationsTerminal']) {
    const report=reviewed(legacy,row,{old:true});report.evidence.providers[field]=false;
    assert.throws(()=>legacy.planReconciliation(report,row,'qa',NOW),/legacy_evidence_required/);
  }
  const {plan}=await f.prepare();
  f.db.exec(`INSERT INTO voice_provider_calls(id,auth_id,session_id,state,provider_key_sha256) VALUES('new','owner','${SESSION}','creating','${KEY}');`);
  await assert.rejects(f.db.prepare(plan.sql).run());assert.equal((await f.read()).legacy_unverified,1);assert.equal((await f.audits()).length,0);
});
test('CLI selects one target, keeps reports private, defaults to read-only and holds production application',async t=>{
  const f=fixture(t),reportPath=join(f.dir,'inspection.json');let writes=0;
  const query=async(_env,sql)=>{if(sql.startsWith('INSERT')){writes++;await f.db.prepare(sql).run();return [];}return (await f.db.prepare(sql).all()).results;};
  const args=parseArgs(['--env=qa','--voice-call=attempt','--report='+reportPath]);await run(args,{query,now:()=>NOW});
  assert.equal(writes,0);assert.equal(statSync(reportPath).mode & 0o777,0o600);assert.equal(JSON.parse(readFileSync(reportPath)).evidence,null);
  assert.throws(()=>parseArgs(['--env=qa','--job=job','--voice-call=attempt','--report='+join(f.dir,'bad')]),/one_target_required/);
  assert.throws(()=>parseArgs(['--env=prod','--voice-call=attempt','--report='+join(f.dir,'prod'),'--review=review','--apply']),/production_reconciliation_held/);
  const reviewPath=join(f.dir,'review.json'),{report}=await f.prepare();writeFileSync(reviewPath,JSON.stringify(report),{mode:0o600});
  await run({...args,report:join(f.dir,'plan.json'),review:reviewPath},{query,now:()=>NOW});assert.equal(writes,0);
  const result=await run({...args,report:join(f.dir,'apply.json'),review:reviewPath,apply:true},{query,now:()=>NOW});assert.equal(result.mode,'applied');assert.equal(writes,1);
});
test('lost apply response preserves the receipt ID for lookup without another write',async t=>{
  const f=fixture(t),{report}=await f.prepare(),reviewPath=join(f.dir,'review.json'),output=join(f.dir,'lost.json');
  writeFileSync(reviewPath,JSON.stringify(report));let writes=0;
  const query=async(_env,sql)=>{if(sql.startsWith('INSERT')){writes++;await f.db.prepare(sql).run();throw Error('fixture lost response');}return (await f.db.prepare(sql).all()).results;};
  const args=parseArgs(['--env=qa','--voice-call=attempt','--review='+reviewPath,'--report='+output,'--apply']);
  await assert.rejects(run(args,{query,now:()=>NOW}),/lost response/);const pending=JSON.parse(readFileSync(output));assert.equal(pending.mode,'apply_pending');
  const result=await run(parseArgs(['--env=qa','--voice-call=attempt','--receipt='+pending.id,'--report='+join(f.dir,'receipt.json')]),{query});
  assert.equal(result.found,true);assert.equal(writes,1);
});
