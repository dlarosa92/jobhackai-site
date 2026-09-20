import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sqliteD1} from './sqlite-d1-helper.mjs';
import {inspectionSql,inspectReport,planReconciliation} from '../../../scripts/lib/deletion-execution-reconcile-core.mjs';
import {parseArgs,run,d1Query} from '../../../scripts/deletion-execution-reconcile.mjs';
const now=Date.parse('2026-09-20T12:00:00Z');
function setup(t) {
  const db=sqliteD1();t.after(()=>db.close());
  db.exec(readFileSync(new URL('../../../db/migrations/028_account_deletion_recovery.sql',import.meta.url),'utf8'));
  db.exec(`INSERT INTO account_deletion_admissions(id,auth_id,origin) VALUES('job','owner','user_request');
    INSERT INTO account_deletion_jobs(id,auth_id,phase,kv_keys_json,execution_token,execution_started_at,updated_at,attempts,email)
    VALUES('job','owner','billing_verified','["resume:owner"]','execution-1','2026-09-20 10:00:00','2026-09-20 10:30:00',2,'private@example.test');`);
  const dir=mkdtempSync(join(tmpdir(),'reconciliation-tests-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return {db,dir,read:()=>db.prepare(inspectionSql('job')).first(),
    audit:()=>db.prepare('SELECT * FROM deletion_execution_reconciliations').all(),
    row:()=>db.prepare('SELECT * FROM account_deletion_jobs').first()};
}
function reviewed(job) {
  const report=inspectReport('qa',job,now);
  report.evidence={operatorRef:'operator-fixture',
    invocation:{status:'terminated',executionToken:job.execution_token,observedAt:'2026-09-20T11:50:00Z',reference:'evidence/invocation-1'},
    providers:{status:'settled',pendingRequests:false,observedAt:'2026-09-20T11:55:00Z',reference:'evidence/providers-1'}};
  return report;
}
test('reconciliation releases only the stopped execution, preserves phase/content/intent, and records its evidence',async t=>{
  const f=setup(t),before=await f.row(),current=await f.read();
  const plan=planReconciliation(reviewed(current),current,'qa',now);
  await f.db.prepare(plan.sql).run();const after=await f.row();
  assert.equal(after.execution_token,null);assert.equal(after.execution_started_at,null);
  for(const key of ['id','auth_id','phase','email','kv_keys_json','attempts'])assert.equal(after[key],before[key]);
  const audit=(await f.audit()).results[0];assert.equal(audit.evidence_sha256,plan.evidenceHash);assert.equal(audit.id,plan.id);
  assert.equal(audit.invocation_ref,'evidence/invocation-1');assert.equal('email' in audit,false);
  assert.equal(await f.db.prepare('SELECT state FROM account_deletion_admissions').first('state'),'requested');
  assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM account_deletion_notifications').first('n'),0);
});
test('an inventory, elapsed time, or an unconfirmed/live invocation cannot authorize release',async t=>{
  const f=setup(t),current=await f.read();
  assert.throws(()=>planReconciliation(inspectReport('qa',current),current,'qa',now),/evidence_required/);
  for(const change of [r=>r.evidence.invocation.status='running',r=>r.evidence.invocation.executionToken='other',
    r=>r.evidence.providers.pendingRequests=true,r=>r.evidence.providers.status='unknown',r=>r.evidence.operatorRef='',
    r=>r.evidence.invocation.observedAt='2026-09-20T09:00:00Z',r=>r.evidence.providers.observedAt='2026-09-20T11:00:00Z',
    r=>r.evidence.providers.observedAt='2026-09-20T12:01:00Z',r=>r.evidence.providers.observedAt='2026-02-30T11:55:00Z']) {
    const report=reviewed(current);change(report);assert.throws(()=>planReconciliation(report,current,'qa',now),/evidence_required/);
  }
  assert.equal((await f.row()).execution_token,'execution-1');assert.equal((await f.audit()).results.length,0);
});
test('environment and database identity must match the reviewed snapshot',async t=>{
  const f=setup(t),current=await f.read(),report=reviewed(current);
  assert.throws(()=>planReconciliation(report,current,'dev',now),/target_mismatch/);
  report.databaseId='other';assert.throws(()=>planReconciliation(report,current,'qa',now),/target_mismatch/);
  assert.throws(()=>planReconciliation(report,current,'__proto__',now),/environment_required/);
});
for(const change of ["UPDATE account_deletion_jobs SET execution_token='new-execution'",
  "UPDATE account_deletion_jobs SET phase='identity_removed'",
  "UPDATE account_deletion_jobs SET updated_at='2026-09-20 11:45:00'",
  "UPDATE account_deletion_jobs SET attempts=attempts+1",
  "UPDATE account_deletion_jobs SET auth_id='other'",
  "UPDATE account_deletion_admissions SET origin='inactivity'",
  "UPDATE account_deletion_admissions SET state='complete'",
  "INSERT INTO account_operation_claims(id,auth_id,kind) VALUES('earlier','owner','account')"])test(`atomic application rejects drift: ${change}`,async t=>{
  const f=setup(t),current=await f.read(),plan=planReconciliation(reviewed(current),current,'qa',now);
  f.db.exec(change);const before=await f.row();
  await assert.rejects(f.db.prepare(plan.sql).run());assert.deepEqual(await f.row(),before);
  assert.equal((await f.audit()).results.length,0);
});
test('two independently prepared applications cannot both commit and replay cannot unlock a new run',async t=>{
  const f=setup(t),current=await f.read(),report=reviewed(current);
  const first=planReconciliation(report,current,'qa',now),second=planReconciliation(report,current,'qa',now);
  await f.db.prepare(first.sql).run();
  await assert.rejects(f.db.prepare(second.sql).run());
  f.db.exec("UPDATE account_deletion_jobs SET execution_token='next-run',execution_started_at='2026-09-20 12:00:00'");
  await assert.rejects(f.db.prepare(first.sql).run());
  assert.equal((await f.row()).execution_token,'next-run');assert.equal((await f.audit()).results.length,1);
});
test('a failure to persist the audit rolls back the execution release',async t=>{
  const f=setup(t),current=await f.read(),plan=planReconciliation(reviewed(current),current,'qa',now);
  f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON deletion_execution_reconciliations BEGIN SELECT RAISE(ABORT,'fixture'); END;");
  await assert.rejects(f.db.prepare(plan.sql).run());assert.equal((await f.row()).execution_token,'execution-1');
  assert.equal((await f.audit()).results.length,0);
});
test('completed jobs, missing tokens, and unsettled claims are not releasable',async t=>{
  const f=setup(t),current=await f.read();
  for(const patch of [{phase:'complete'},{execution_token:null},{pending_operations:1},{admission_state:'complete'}]) {
    const altered={...current,...patch};assert.throws(()=>planReconciliation(reviewed(altered),altered,'qa',now),/not_releasable/);
  }
  const report=reviewed(current);report.snapshot.attempts++;
  assert.throws(()=>planReconciliation(report,current,'qa',now),/snapshot_changed/);
});
test('storage-only evidence is accepted only after recorded identity removal',async t=>{
  const f=setup(t),current=await f.read(),report=reviewed(current);report.evidence.providers.status='storage_only';
  assert.throws(()=>planReconciliation(report,current,'qa',now),/evidence_required/);
  f.db.exec("UPDATE account_deletion_jobs SET phase='identity_removed'");const removed=await f.read(),review=reviewed(removed);
  review.evidence.providers.status='storage_only';await f.db.prepare(planReconciliation(review,removed,'qa',now).sql).run();
  assert.equal((await f.row()).phase,'identity_removed');
});
test('argument parsing is explicit, prevents production apply, and never guesses a target',()=>{
  const base=['--env=qa','--job=job','--report=/tmp/output'];
  assert.equal(parseArgs(base).apply,false);
  for(const args of [[],[...base,'--env=dev'],[...base,'--apply'],[...base,'--unknown=yes'],
    ['--env=prod','--job=job','--report=/tmp/output','--review=/tmp/review','--apply'],
    [...base,'--receipt=id','--review=/tmp/review'],[...base,'--job=bad\0']])assert.throws(()=>parseArgs(args));
});
test('CLI inspection writes private minimal evidence, refuses overwrite, and performs no mutations',async t=>{
  const f=setup(t),current=await f.read(),output=join(f.dir,'report.json'),calls=[];
  const result=await run(parseArgs(['--env=qa','--job=job','--report='+output]),{now:()=>now,query:(env,sql)=>{
    assert.equal(env,'qa');assert.match(sql,/^SELECT /);calls.push(sql);return [current];}});
  assert.equal(result.mode,'inspection');assert.equal(calls.length,1);
  const report=JSON.parse(readFileSync(output));assert.equal(report.evidence,null);
  assert.equal('email' in report.snapshot,false);assert.equal('kv_keys_json' in report.snapshot,false);
  assert.equal(statSync(output).mode & 0o777,0o600);
  await assert.rejects(()=>run({env:'qa',job:'job',report:output},{query:()=>assert.fail('must not query')}),/EEXIST/);
});
test('CLI planning does not dispatch its generated mutation and lost apply responses retain the exact receipt ID',async t=>{
  const f=setup(t),current=await f.read(),reviewPath=join(f.dir,'review.json');writeFileSync(reviewPath,JSON.stringify(reviewed(current)));
  const args={env:'qa',job:'job',review:reviewPath,report:join(f.dir,'plan.json')};let reads=0;
  await run(args,{now:()=>now,query:()=>{reads++;return [current];}});assert.equal(reads,1);
  const failedOutput=join(f.dir,'failed.json');
  await assert.rejects(()=>run({...args,apply:true,report:failedOutput},{now:()=>now,query:(env,sql)=>{
    if(sql.startsWith('SELECT'))return [current];
    assert.match(sql,/^INSERT INTO deletion_execution_reconciliations/);throw Error('fixture_response_lost');
  }}),/response_lost/);
  const pending=JSON.parse(readFileSync(failedOutput));assert.equal(pending.mode,'apply_pending');assert.ok(pending.id);assert.ok(pending.evidenceHash);
  let query;
  const receipt=await run({env:'qa',job:'job',receipt:pending.id,report:join(f.dir,'receipt.json')},{query:(_,sql)=>{query=sql;return [];}});
  assert.equal(receipt.found,false);assert.match(query,/^SELECT /);assert.ok(query.includes(pending.id));
});
test('CLI apply and receipt lookup work against real SQLite without writing any provider or content state',async t=>{
  const f=setup(t),current=await f.read(),reviewPath=join(f.dir,'review.json');
  writeFileSync(reviewPath,JSON.stringify(reviewed(current)));
  const calls=[],query=async(env,sql)=>{assert.equal(env,'qa');calls.push(sql);return (await f.db.prepare(sql).all()).results;};
  const result=await run({env:'qa',job:'job',apply:true,review:reviewPath,report:join(f.dir,'applied.json')},{now:()=>now,query});
  assert.equal(result.mode,'applied');assert.equal((await f.row()).execution_token,null);
  assert.equal((await f.row()).phase,'billing_verified');assert.equal(calls.filter(sql=>sql.startsWith('INSERT')).length,1);
  const receipt=await run({env:'qa',job:'job',receipt:result.id,report:join(f.dir,'receipt.json')},{query});
  assert.equal(receipt.found,true);
  const audit=(await f.audit()).results[0];assert.equal(JSON.parse(readFileSync(join(f.dir,'applied.json'))).evidenceHash,audit.evidence_sha256);
});
test('quoted owner identifiers remain data in the atomic snapshot guard',async t=>{
  const f=setup(t);await f.db.prepare('UPDATE account_deletion_jobs SET auth_id=?').bind("owner'--").run();
  await f.db.prepare('UPDATE account_deletion_admissions SET auth_id=?').bind("owner'--").run();
  const current=await f.read();await f.db.prepare(planReconciliation(reviewed(current),current,'qa',now).sql).run();
  assert.equal((await f.row()).auth_id,"owner'--");assert.equal((await f.row()).phase,'billing_verified');
});
test('transport pins the target, executes one query rather than bulk import, and hides raw failures',()=>{
  let configPath;
  const result=d1Query('qa','SELECT 1 AS probe',{execute:(command,args,options)=>{
    assert.equal(command,'npx');assert.equal(args.includes('--file'),false);assert.ok(args.includes('--remote'));
    assert.equal(args[args.indexOf('--command')+1],'SELECT 1 AS probe');
    configPath=args[args.indexOf('--config')+1];const config=JSON.parse(readFileSync(configPath));
    assert.equal(config.account_id,'fabf4409ef32f8c64354a1a099bef2a2');
    assert.equal(config.d1_databases[0].database_id,'80d87a73-6615-4823-b7a4-19a8821b4f87');
    assert.equal(options.stdio[2],'pipe');
    return JSON.stringify([{success:true,results:[{probe:1}]}]);
  }});
  assert.deepEqual(result,[{probe:1}]);assert.equal(existsSync(configPath),false);
  for(const execute of [()=>{throw Error('private provider diagnostic');},()=>'{invalid json',()=>JSON.stringify([{success:false,results:[]}])]) {
    assert.throws(()=>d1Query('qa','SELECT 1',{execute}),error=>error.message==='reconciliation_database_request_failed');
  }
});
