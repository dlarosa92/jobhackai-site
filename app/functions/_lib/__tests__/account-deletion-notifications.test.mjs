import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { deliverDeletionNotifications } from '../account-deletion-notifications.js';
import { finishDeletionRecovery } from '../account-deletion-recovery.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

function setup(t) {
  const db=sqliteD1();t.after(()=>db.close());
  db.exec(readFileSync(new URL('../../../db/migrations/028_account_deletion_recovery.sql',import.meta.url),'utf8'));
  db.exec(`INSERT INTO account_deletion_jobs(id,auth_id,phase,kv_keys_json) VALUES('job-owner','owner','complete','[]');
    INSERT INTO account_deletion_admissions(id,auth_id,origin,state) VALUES('job-owner','owner','user_request','complete');
    INSERT INTO account_deletion_notifications(job_id,email) VALUES('job-owner','owner@example.test');`);
  const env={JOBHACKAI_DB:db,ENVIRONMENT:'qa',INACTIVITY_MODE:'execute',INACTIVITY_TEST_UID:'owner',
    FRONTEND_URL:'https://qa.jobhackai.io',RESEND_API_KEY:'fixture-only'};
  const state={outcome:'accepted',onSend:null},calls=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(url,'https://api.resend.com/emails');assert.equal(init.method,'POST');
    calls.push({headers:init.headers,body:init.body});await state.onSend?.();
    if(state.outcome==='timeout')throw Error('private fixture timeout');
    if(state.outcome==='malformed')return Response.json({});
    if(typeof state.outcome==='number')return Response.json({error:'private fixture error'},{status:state.outcome});
    return Response.json({id:'mail_completed_fixture'});
  });
  return {db,env,state,calls,run:()=>deliverDeletionNotifications(env),
    row:()=>db.prepare("SELECT * FROM account_deletion_notifications WHERE job_id='job-owner'").first(),
    phase:()=>db.prepare("SELECT phase FROM account_deletion_jobs WHERE id='job-owner'").first('phase')};
}

test('completion notice requires completed erasure and clears its address only after provider acceptance',async t=>{
  const f=setup(t);f.state.onSend=async()=>{
    const row=await f.row();assert.equal(row.state,'sending');assert.ok(row.execution_token);assert.equal(row.attempts,1);
    assert.equal(await f.phase(),'complete');
  };
  const result=await f.run();assert.equal(result.accepted,1);const row=await f.row();
  assert.equal(row.state,'sent');assert.equal(row.email,null);assert.equal(row.provider_id,'mail_completed_fixture');assert.equal(row.execution_token,null);
  const body=JSON.parse(f.calls[0].body);assert.deepEqual(body.to,['owner@example.test']);assert.match(body.subject,/^\[QA\]/);
  assert.match(body.html,/Required billing and security records are retained/);assert.match(body.html,/job-owner/);
  assert.equal(f.calls[0].headers['Idempotency-Key'],'account-deletion/job-owner');
  await f.run();assert.equal(f.calls.length,1);assert.equal(await f.phase(),'complete');
});
test('an incomplete parent job or admission cannot dispatch a completion email',async t=>{
  const f=setup(t);f.db.exec("UPDATE account_deletion_jobs SET phase='identity_removed'");
  assert.equal((await f.run()).eligible,0);assert.equal(f.calls.length,0);
  f.db.exec("UPDATE account_deletion_jobs SET phase='complete';UPDATE account_deletion_admissions SET state='requested'");
  assert.equal((await f.run()).eligible,0);assert.equal(f.calls.length,0);assert.equal((await f.row()).state,'pending');
});
test('audit inspects but never claims, sends, redacts or purges notification records',async t=>{
  const f=setup(t);delete f.env.INACTIVITY_MODE;const before=await f.row();
  assert.equal((await f.run()).eligible,1);assert.deepEqual(await f.row(),before);
  f.db.exec("UPDATE account_deletion_notifications SET expires_at='2000-01-01'");const expired=await f.row();
  assert.equal((await f.run()).expired_addresses_remaining,1);assert.deepEqual(await f.row(),expired);assert.equal(f.calls.length,0);
});
for(const outcome of ['timeout','malformed',408,409,429,503])test(`ambiguous completion outcome ${outcome} is never automatically resent`,async t=>{
  const f=setup(t);f.state.outcome=outcome;assert.equal((await f.run()).uncertain,1);
  assert.equal((await f.row()).state,'needs_review');assert.ok((await f.row()).execution_token);
  f.db.exec("UPDATE account_deletion_notifications SET execution_started_at='2000-01-01',next_attempt_at='2000-01-01'");
  await f.run();assert.equal(f.calls.length,1);assert.equal(await f.phase(),'complete');
});
test('definitive rejection backs off, caps attempts and preserves the exact payload and key',async t=>{
  const f=setup(t);f.state.outcome=422;assert.equal((await f.run()).rejected,1);
  assert.equal((await f.row()).state,'pending');assert.equal((await f.row()).execution_token,null);
  await f.run();assert.equal(f.calls.length,1);
  for(let attempt=2;attempt<=3;attempt++) {
    f.db.exec("UPDATE account_deletion_notifications SET next_attempt_at=datetime('now','-1 second')");
    const result=await f.run();assert.equal(result.rejected,1);assert.equal(result.failed,attempt===3?1:0);
  }
  assert.equal((await f.row()).state,'needs_review');assert.equal((await f.row()).attempts,3);
  await f.run();assert.equal(f.calls.length,3);assert.equal(new Set(f.calls.map(call=>call.body)).size,1);
  assert.equal(new Set(f.calls.map(call=>call.headers['Idempotency-Key'])).size,1);assert.equal(await f.phase(),'complete');
});
test('overlapping senders cannot dispatch a second completion notice',async t=>{
  const f=setup(t);let start,finish;const started=new Promise(resolve=>{start=resolve;}),released=new Promise(resolve=>{finish=resolve;});
  f.state.onSend=async()=>{start();await released;};
  const first=f.run();await started;assert.equal((await f.run()).eligible,0);assert.equal(f.calls.length,1);
  finish();assert.equal((await first).accepted,1);assert.equal(f.calls.length,1);
});
test('acceptance followed by persistence failure keeps the send fenced and never reopens erasure',async t=>{
  const f=setup(t);f.db.exec("CREATE TRIGGER deny_receipt BEFORE UPDATE ON account_deletion_notifications WHEN NEW.state='sent' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END;");
  assert.equal((await f.run()).failed,1);assert.equal((await f.row()).state,'sending');assert.ok((await f.row()).execution_token);
  f.db.exec('DROP TRIGGER deny_receipt');await f.run();assert.equal(f.calls.length,1);assert.equal(await f.phase(),'complete');
});
test('an abandoned sending record cannot acquire a replacement token',async t=>{
  const f=setup(t);f.db.exec("UPDATE account_deletion_notifications SET state='sending',execution_token='old-worker',execution_started_at='2000-01-01'");
  await f.run();assert.equal(f.calls.length,0);assert.equal((await f.row()).execution_token,'old-worker');
});
test('expiry redacts the address independently of credentials and never permits a later retry',async t=>{
  const f=setup(t);delete f.env.RESEND_API_KEY;f.db.exec("UPDATE account_deletion_notifications SET expires_at=datetime('now','-1 second')");
  assert.equal((await f.run()).addresses_redacted,1);assert.equal((await f.row()).email,null);assert.equal((await f.row()).state,'expired');
  f.env.RESEND_API_KEY='fixture-only';await f.run();assert.equal(f.calls.length,0);assert.equal(await f.phase(),'complete');
});
test('expiry during an in-flight send never restores an address or creates another dispatch',async t=>{
  const f=setup(t);f.state.onSend=async()=>{
    f.db.exec("UPDATE account_deletion_notifications SET expires_at='2000-01-01'");
    assert.equal((await f.run()).addresses_redacted,1);assert.equal((await f.row()).email,null);assert.equal((await f.row()).state,'expired');
  };
  assert.equal((await f.run()).accepted,1);assert.equal((await f.row()).email,null);assert.equal((await f.row()).state,'sent');
  await f.run();assert.equal(f.calls.length,1);
});
test('expiry during an ambiguous send keeps a redacted terminal record',async t=>{
  const f=setup(t);f.state.outcome='timeout';f.state.onSend=async()=>{
    f.db.exec("UPDATE account_deletion_notifications SET expires_at='2000-01-01'");await f.run();
  };
  assert.equal((await f.run()).uncertain,1);assert.equal((await f.row()).state,'expired');assert.equal((await f.row()).email,null);
  await f.run();assert.equal(f.calls.length,1);
});
test('old notification receipts can be purged without removing the completion or consent receipts',async t=>{
  const f=setup(t);await f.run();f.db.exec("UPDATE account_deletion_notifications SET created_at=datetime('now','-91 days')");
  assert.equal((await f.run()).receipts_purged,1);assert.equal(await f.row(),null);
  assert.equal(await f.phase(),'complete');assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM account_deletion_admissions').first('n'),1);
  assert.equal((await finishDeletionRecovery(f.env,'job-owner')).alreadyComplete,true);
  await f.run();assert.equal(f.calls.length,1);assert.equal(await f.row(),null);
});
test('scope applies to dispatch and redaction after the account row is gone',async t=>{
  const f=setup(t);f.db.exec(`INSERT INTO account_deletion_jobs(id,auth_id,phase,kv_keys_json) VALUES('other-job','other','complete','[]');
    INSERT INTO account_deletion_admissions(id,auth_id,origin,state) VALUES('other-job','other','user_request','complete');
    INSERT INTO account_deletion_notifications(job_id,email,expires_at) VALUES('other-job','other@example.test','2000-01-01');`);
  assert.equal((await f.run()).accepted,1);assert.equal(f.calls.length,1);
  assert.equal(await f.db.prepare("SELECT email FROM account_deletion_notifications WHERE job_id='other-job'").first('email'),'other@example.test');
});
test('redaction and receipt purging are bounded and expose remaining expired addresses',async t=>{
  const f=setup(t);f.env.ENVIRONMENT='production';f.env.FRONTEND_URL='https://app.jobhackai.io';delete f.env.INACTIVITY_TEST_UID;delete f.env.RESEND_API_KEY;
  for(let i=0;i<100;i++)f.db.exec(`INSERT INTO account_deletion_jobs(id,auth_id,phase,kv_keys_json) VALUES('job${i}','uid${i}','complete','[]');
    INSERT INTO account_deletion_admissions(id,auth_id,origin,state) VALUES('job${i}','uid${i}','user_request','complete');
    INSERT INTO account_deletion_notifications(job_id,email) VALUES('job${i}','fixture${i}@example.test');`);
  f.db.exec("UPDATE account_deletion_notifications SET expires_at='2000-01-01'");
  const first=await f.run();assert.equal(first.addresses_redacted,100);assert.equal(first.expired_addresses_remaining,1);
  assert.equal((await f.run()).addresses_redacted,1);
  f.db.exec("UPDATE account_deletion_notifications SET created_at='2000-01-01'");
  assert.equal((await f.run()).receipts_purged,100);assert.equal((await f.run()).receipts_purged,1);
  assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM account_deletion_jobs').first('n'),101);assert.equal(f.calls.length,0);
});
test('missing delivery configuration preserves pending work and invalid metadata never reaches the provider',async t=>{
  const f=setup(t);delete f.env.RESEND_API_KEY;assert.equal((await f.run()).failed,1);assert.equal((await f.row()).attempts,0);
  f.env.RESEND_API_KEY='fixture-only';f.env.FRONTEND_URL='https://foreign.test';assert.equal((await f.run()).failed,1);assert.equal(f.calls.length,0);
  f.env.FRONTEND_URL='https://qa.jobhackai.io';f.db.exec("UPDATE account_deletion_notifications SET template_version='unknown'");
  assert.equal((await f.run()).failed,1);assert.equal((await f.row()).state,'needs_review');assert.equal(f.calls.length,0);
});
test('the schema prevents successful or expired receipts from retaining a notification address',async t=>{
  const f=setup(t);
  for(const state of ['sent','expired'])assert.throws(()=>f.db.exec(`UPDATE account_deletion_notifications SET state='${state}'`),/CHECK constraint failed/);
  assert.throws(()=>f.db.exec('UPDATE account_deletion_notifications SET email=NULL'),/CHECK constraint failed/);
});
