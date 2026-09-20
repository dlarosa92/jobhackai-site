import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { processAccountDeletion } from '../account-deletion-process.js';
import { beginDeletionAdmission, admitAccountOperation, settleAccountOperation } from '../account-deletion-admission.js';
import { prepareDeletionRecovery, advanceDeletionRecovery, withdrawInactiveDeletion } from '../account-deletion-recovery.js';
import { createFirebaseDeletionClient } from '../../../../shared/firebase-deletion-client.js';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { createFakeKV, stubStripeFetch } from './billing-test-helper.mjs';
import { inspectionSql, inspectReport, planReconciliation } from '../../../scripts/lib/deletion-execution-reconcile-core.mjs';
if(!globalThis.crypto) globalThis.crypto=webcrypto;
const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const credentials=JSON.stringify({project_id:'fixture-project',client_email:'fixture@fixture-project.iam.gserviceaccount.com',private_key:privateKey});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

function setup(t) {
  const db=sqliteD1();t.after(()=>db.close());
  const sql=name=>readFileSync(new URL('../../../db/'+name,import.meta.url),'utf8');
  db.exec(sql('schema.sql'));
  for(const name of ['002_add_feature_daily_usage','006_linkedin_runs','008_add_cookie_consents','009_role_templates',
    '024_collected_payments','025_checkout_attribution','026_payment_campaign_links','027_analytics_delivery','028_account_deletion_recovery']) {
    db.exec(sql('migrations/'+name+'.sql'));
  }
  const cover=readFileSync(new URL('../../api/cover-letter/generate.js',import.meta.url),'utf8');
  db.exec(cover.match(/`(CREATE TABLE IF NOT EXISTS cover_letter_history[\s\S]+?)`/)[1]);
  db.exec("INSERT INTO users(id,auth_id,email,stripe_customer_id) VALUES(1,'owner','owner@example.test','cus_owner')");
  const kv=createFakeKV();
  const env={DB:db,JOBHACKAI_KV:kv,ENVIRONMENT:'qa',STRIPE_SECRET_KEY:'sk_test_fixture',
    FIREBASE_PROJECT_ID:'fixture-project',FIREBASE_SERVICE_ACCOUNT_JSON:credentials};
  const fixture={exists:true,billingFails:false,deleteFails:false,deleteTimeout:false,lookupFails:false,
    sub:{id:'sub_owner',customer:'cus_owner',status:'active',metadata:{firebaseUid:'owner',environment:'qa'}},
    billingWait:null,lookupReply:null,failLookupAfterDelete:false};
  const events=[];
  const stub=stubStripeFetch([
    {match:'oauth2.googleapis.com/token',reply:()=>({json:{access_token:'fixture-token'}})},
    {match:'accounts:lookup',reply:()=>{
      events.push('lookup');if(fixture.lookupFails)throw Error('private fixture diagnostic');
      return {json:fixture.lookupReply || (fixture.exists?{users:[{localId:'owner',...fixture.activity}]}:{})};
    }},
    {match:'accounts:delete',reply:async()=>{
      events.push('identity-delete');
      assert.equal((await row()).phase,'billing_verified');
      assert.ok((await row()).execution_token);
      if(!fixture.deleteFails)fixture.exists=false;
      if(fixture.failLookupAfterDelete)fixture.lookupFails=true;
      if(fixture.deleteTimeout)throw Error('private identity timeout');
      return fixture.deleteFails?{status:503,json:{error:{message:'private identity error'}}}:{json:{}};
    }},
    {match:'api.stripe.com',reply:async(url,init)=>{
      events.push('stripe:'+init.method+':'+new URL(url).pathname);
      const job=await row();assert.ok(job?.execution_token,'manifest and execution claim precede billing');
      if(fixture.billingWait)await fixture.billingWait();
      if(fixture.billingFails)return {status:503,json:{error:'private billing diagnostic'}};
      const path=new URL(url).pathname;
      if(init.method==='DELETE'){fixture.sub.status='canceled';return {json:fixture.sub};}
      const customer={id:'cus_owner',metadata:{firebaseUid:'owner'}};
      if(path==='/v1/customers/cus_owner')return {json:customer};
      if(path==='/v1/customers')return {json:{data:[customer],has_more:false}};
      if(path==='/v1/subscriptions')return {json:{data:[fixture.sub],has_more:false}};
      return {json:{data:[],has_more:false}};
    }}
  ]);
  t.after(()=>stub.restore());
  const row=()=>db.prepare("SELECT * FROM account_deletion_jobs WHERE auth_id='owner'").first();
  return {db,env,kv,fixture,events,stub,row,
    count:table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n'),
    run:()=>processAccountDeletion(env,{uid:'owner',email:'owner@example.test',requestedByUser:true}),
    resume:()=>processAccountDeletion(env,{uid:'owner'})};
}

async function seedInactive(f) {
  f.db.exec(`UPDATE users SET last_login_at='2020-01-01 00:00:00',last_activity_at=NULL,
    deletion_warning_sent_at=datetime('now','-40 days');
    INSERT INTO account_inactivity_warnings(id,auth_id,email,state,provider_id,sent_at)
    SELECT 'warning',auth_id,email,'sent','mail_fixture',deletion_warning_sent_at FROM users;`);
  f.fixture.activity={lastLoginAt:String(Date.parse('2020-01-01T00:00:00Z'))};
  f.fixture.sub.status='canceled';
  await beginDeletionAdmission(f.env,{uid:'owner',email:'owner@example.test',origin:'inactivity'});
}

test('a recovery invocation cannot create a deletion request from an arbitrary UID',async t=>{
  const f=setup(t);await assert.rejects(f.resume(),/admission_required/);
  assert.equal(await f.count('account_deletion_admissions'),0);assert.equal(f.stub.calls.length,0);
});
test('persisted inactivity origin uses only read-only billing before deleting an eligible warned account',async t=>{
  const f=setup(t);await seedInactive(f);
  const result=await f.resume();assert.equal(result.status,'complete');
  assert.equal(f.events.some(event=>event.startsWith('stripe:DELETE')||event.startsWith('stripe:POST')),false);
  assert.equal(await f.count('users'),0);assert.equal(await f.count('account_inactivity_warnings'),0);
  assert.equal(await f.db.prepare('SELECT origin FROM account_deletion_admissions').first('origin'),'inactivity');
});
test('recent provider activity withdraws an automatic intent and preserves account access',async t=>{
  const f=setup(t);await seedInactive(f);f.fixture.activity.lastRefreshAt=new Date().toISOString();
  const result=await f.resume();assert.equal(result.status,'withdrawn');assert.equal(result.identityRemoved,false);
  assert.equal(await f.count('account_deletion_admissions'),0);assert.equal(await f.count('account_deletion_jobs'),0);
  assert.equal(await f.count('users'),1);assert.equal(f.fixture.exists,true);assert.equal(await f.count('account_deletion_withdrawals'),1);
  assert.equal(f.events.some(event=>event.startsWith('stripe:')||event==='identity-delete'),false);
  assert.ok(await admitAccountOperation(f.env,'owner'));
});
test('an old warning timestamp without recorded acceptance cannot trigger deletion',async t=>{
  const f=setup(t);await seedInactive(f);f.db.exec('DELETE FROM account_inactivity_warnings');
  assert.equal((await f.resume()).status,'withdrawn');assert.equal(f.fixture.exists,true);
  assert.equal(f.events.some(event=>event.startsWith('stripe:')||event==='identity-delete'),false);
});
test('a paid or unverified Stripe account is released from automatic cleanup without billing mutations',async t=>{
  const f=setup(t);await seedInactive(f);f.fixture.sub.status='active';
  assert.equal((await f.resume()).status,'withdrawn');assert.equal(f.fixture.sub.status,'active');
  assert.equal(await f.db.prepare('SELECT reason FROM account_deletion_withdrawals').first('reason'),'inactivity_billing_unconfirmed');
  assert.equal(f.events.some(event=>event.startsWith('stripe:DELETE')||event.startsWith('stripe:POST')||event==='identity-delete'),false);
});
test('provider activity arriving during billing verification stops identity removal',async t=>{
  const f=setup(t);await seedInactive(f);
  f.fixture.billingWait=async()=>{f.fixture.activity.lastRefreshAt=new Date().toISOString();};
  assert.equal((await f.resume()).status,'withdrawn');assert.equal(f.fixture.exists,true);
  assert.equal(f.events.includes('identity-delete'),false);
});
test('a Stripe outage during automatic cleanup restores access when identity is confirmed present',async t=>{
  const f=setup(t);await seedInactive(f);f.fixture.billingFails=true;
  assert.equal((await f.resume()).status,'withdrawn');assert.equal(f.fixture.exists,true);
  assert.equal(await f.count('account_deletion_admissions'),0);
  assert.equal(f.events.some(event=>event.startsWith('stripe:DELETE')||event.startsWith('stripe:POST')||event==='identity-delete'),false);
});
test('explicit user request upgrades the automatic intent and alone permits subscription cancellation',async t=>{
  const f=setup(t);await seedInactive(f);f.fixture.sub.status='active';
  const id=await f.db.prepare('SELECT id FROM account_deletion_admissions').first('id');
  const result=await f.run();assert.equal(result.status,'complete');assert.equal(result.reference,id);
  assert.equal(f.fixture.sub.status,'canceled');
  assert.equal(await f.db.prepare('SELECT origin FROM account_deletion_admissions').first('origin'),'user_request');
});
test('withdrawal cannot erase a concurrent explicit request, take over another runner, or erase confirmed progress',async t=>{
  const f=setup(t);await seedInactive(f);const job=await prepareDeletionRecovery(f.env,{uid:'owner'});
  f.db.exec("UPDATE account_deletion_jobs SET execution_token='active-runner'");
  await assert.rejects(withdrawInactiveDeletion(f.env,job.id,'other-runner'));
  assert.equal(await f.count('account_deletion_withdrawals'),0);
  await beginDeletionAdmission(f.env,{uid:'owner',origin:'user_request'});
  await assert.rejects(withdrawInactiveDeletion(f.env,job.id,'active-runner'));
  assert.equal(await f.count('account_deletion_jobs'),1);assert.equal(await f.count('account_deletion_admissions'),1);
  assert.equal(await f.count('account_deletion_withdrawals'),0);
  f.db.exec("UPDATE account_deletion_admissions SET origin='inactivity';UPDATE account_deletion_jobs SET phase='identity_removed'");
  await assert.rejects(withdrawInactiveDeletion(f.env,job.id,'active-runner'));
  assert.equal(await f.count('account_deletion_jobs'),1);assert.equal(await f.count('account_deletion_withdrawals'),0);
});
test('a user request racing inactivity withdrawal survives and completes on retry',async t=>{
  const f=setup(t);await seedInactive(f);f.fixture.activity.lastRefreshAt=new Date().toISOString();
  const batch=f.db.batch.bind(f.db);let upgraded=false;
  f.db.batch=async statements=>{
    if(!upgraded && statements[0].sql.includes('INSERT INTO account_deletion_withdrawals')) {
      upgraded=true;await beginDeletionAdmission(f.env,{uid:'owner',origin:'user_request'});
    }
    return batch(statements);
  };
  assert.equal((await f.resume()).status,'pending');assert.equal(upgraded,true);
  assert.equal(await f.count('account_deletion_jobs'),1);assert.equal(await f.count('account_deletion_withdrawals'),0);
  assert.equal(await f.db.prepare('SELECT origin FROM account_deletion_admissions').first('origin'),'user_request');
  assert.equal((await f.run()).status,'complete');
});
test('inactivity recovery after confirmed remote identity removal finishes storage without billing mutation',async t=>{
  const f=setup(t);await seedInactive(f);const job=await prepareDeletionRecovery(f.env,{uid:'owner'});
  await advanceDeletionRecovery(f.env,job.id,'billing_verified');f.fixture.exists=false;
  assert.equal((await f.resume()).status,'complete');assert.equal(f.events.some(event=>event.startsWith('stripe:')),false);
});

test('actual processor saves manifest, settles billing, verifies identity removal and atomically queues notification',async t=>{
  const f=setup(t),result=await f.run();
  assert.equal(result.status,'complete');assert.equal(result.identityRemoved,true);
  assert.equal(await f.count('users'),0);assert.equal(f.fixture.exists,false);
  assert.ok(f.events.findIndex(x=>x.startsWith('stripe:DELETE'))<f.events.indexOf('identity-delete'));
  const job=await f.row();assert.equal(job.phase,'complete');assert.equal(job.email,null);assert.equal(job.kv_keys_json,'[]');assert.equal(job.execution_token,null);
  assert.equal(result.reference,await f.db.prepare('SELECT id FROM account_deletion_admissions').first('id'));
  assert.deepEqual(await f.db.prepare('SELECT email,state FROM account_deletion_notifications').first(),{email:'owner@example.test',state:'pending'});
  const count=f.stub.calls.length;delete f.env.JOBHACKAI_KV;delete f.env.STRIPE_SECRET_KEY;delete f.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  assert.equal((await f.run()).status,'complete');assert.equal(f.stub.calls.length,count);
  assert.equal(await f.count('account_deletion_notifications'),1);
});

test('billing failure preserves identity/content and returns the durable pending reference without diagnostics',async t=>{
  const f=setup(t);f.fixture.billingFails=true;
  const result=await f.run();assert.equal(result.status,'pending');assert.equal(result.code,'billing_unconfirmed');
  assert.equal(result.identityRemoved,false);assert.equal(f.fixture.exists,true);assert.equal(await f.count('users'),1);
  assert.equal((await f.row()).phase,'prepared');assert.equal((await f.row()).execution_token,null);
  assert.match(result.message,/Some subscriptions may already be canceled/);
  assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!f.events.includes('identity-delete'));
  f.fixture.billingFails=false;assert.equal((await f.run()).reference,result.reference);
  assert.equal((await f.row()).phase,'complete');
});

test('earlier account operation saves only intent and prevents every billing/identity call until it finishes',async t=>{
  const f=setup(t),claim=await admitAccountOperation(f.env,'owner','billing');
  const result=await f.run();assert.equal(result.code,'waiting_for_operations');assert.equal(f.stub.calls.length,0);
  assert.equal(await f.count('account_deletion_jobs'),0);assert.equal(await f.count('account_deletion_admissions'),1);
  await settleAccountOperation(f.env,claim,'finished');
  const done=await f.run();assert.equal(done.status,'complete');assert.equal(done.reference,result.reference);
});

test('simultaneous retry cannot execute providers while the first runner holds its token',async t=>{
  const f=setup(t),entered=deferred(),release=deferred();
  f.fixture.billingWait=async()=>{entered.resolve();await release.promise;};
  const first=f.run();await entered.promise;const before=f.stub.calls.length;
  const second=await f.run();assert.equal(second.code,'execution_in_progress');assert.equal(f.stub.calls.length,before);
  release.resolve();assert.equal((await first).status,'complete');
  assert.equal(f.events.filter(x=>x==='identity-delete').length,1);
});

test('a crashed execution token never expires into permission to delete',async t=>{
  const f=setup(t);await beginDeletionAdmission(f.env,{origin:'user_request',uid:'owner'});const job=await prepareDeletionRecovery(f.env,{uid:'owner'});
  f.db.exec("UPDATE account_deletion_jobs SET execution_token='interrupted',execution_started_at='2000-01-01'");
  const result=await f.run();assert.equal(result.code,'execution_in_progress');assert.equal(result.reference,job.id);
  assert.equal(f.stub.calls.length,0);assert.equal((await f.row()).execution_token,'interrupted');
});

test('a reconciled stopped execution resumes the real processor without repeating confirmed remote deletion',async t=>{
  const f=setup(t);await beginDeletionAdmission(f.env,{origin:'user_request',uid:'owner'});
  const job=await prepareDeletionRecovery(f.env,{uid:'owner'});
  await advanceDeletionRecovery(f.env,job.id,'billing_verified');
  f.fixture.exists=false;
  f.db.exec("UPDATE account_deletion_jobs SET execution_token='interrupted',execution_started_at=datetime('now','-1 hour')");
  const current=await f.db.prepare(inspectionSql(job.id)).first(),now=Date.now();
  const report=inspectReport('qa',current,now);
  report.evidence={operatorRef:'fixture-operator',
    invocation:{status:'terminated',executionToken:'interrupted',observedAt:new Date(now-2000).toISOString(),reference:'fixture/invocation'},
    providers:{status:'settled',pendingRequests:false,observedAt:new Date(now-1000).toISOString(),reference:'fixture/identity-absent'}};
  await f.db.prepare(planReconciliation(report,current,'qa',now).sql).run();
  assert.equal((await f.resume()).status,'complete');
  assert.equal(f.events.filter(event=>event==='identity-delete'||event.startsWith('stripe:')).length,0);
  assert.equal(await f.count('deletion_execution_reconciliations'),1);assert.equal(await f.count('users'),0);
  assert.equal(await f.count('account_deletion_notifications'),1);
});

test('identity failure leaves the confirmed billing phase and resumes with a fresh billing check',async t=>{
  const f=setup(t);f.fixture.deleteFails=true;
  const first=await f.run();assert.equal(first.status,'pending');assert.equal(first.code,'identity_unconfirmed');
  assert.equal((await f.row()).phase,'billing_verified');assert.equal(await f.count('users'),1);assert.equal(f.fixture.exists,true);
  const before=f.events.filter(x=>x.startsWith('stripe:')).length;f.fixture.deleteFails=false;
  assert.equal((await f.run()).status,'complete');assert.ok(f.events.filter(x=>x.startsWith('stripe:')).length>before);
  assert.equal(f.events.filter(x=>x.startsWith('stripe:DELETE')).length,1,'already canceled subscription is not canceled again');
});

test('an ambiguous delete is reconciled by a fresh lookup rather than assuming failure or success',async t=>{
  const f=setup(t);f.fixture.deleteTimeout=true;
  assert.equal((await f.run()).status,'complete');
  assert.equal(f.events.filter(x=>x==='identity-delete').length,1);assert.equal(f.events.filter(x=>x==='lookup').length,2);
});

test('unconfirmed identity outcome stays pending and a later lookup resumes without repeating billing',async t=>{
  const f=setup(t);f.fixture.failLookupAfterDelete=true;
  const first=await f.run();assert.equal(first.code,'identity_unconfirmed');assert.equal(first.identityRemoved,null);
  assert.equal((await f.row()).phase,'billing_verified');assert.equal(await f.count('users'),1);
  const calls=f.events.filter(x=>x.startsWith('stripe:')).length;f.fixture.lookupFails=false;
  assert.equal((await f.run()).status,'complete');assert.equal(f.events.filter(x=>x.startsWith('stripe:')).length,calls);
  assert.equal(f.events.filter(x=>x==='identity-delete').length,1);
});

test('retry after confirmed remote deletion but failed phase persistence skips all billing/identity mutations',async t=>{
  const f=setup(t);
  f.db.exec("CREATE TRIGGER deny_identity_phase BEFORE UPDATE OF phase ON account_deletion_jobs WHEN NEW.phase='identity_removed' BEGIN SELECT RAISE(ABORT,'fixture phase outage'); END;");
  const first=await f.run();assert.equal(first.status,'pending');assert.equal(first.identityRemoved,true);
  assert.equal((await f.row()).phase,'billing_verified');assert.equal(f.fixture.exists,false);
  const billing=f.events.filter(x=>x.startsWith('stripe:')).length;f.db.exec('DROP TRIGGER deny_identity_phase');
  assert.equal((await f.run()).status,'complete');assert.equal(f.events.filter(x=>x.startsWith('stripe:')).length,billing);
  assert.equal(f.events.filter(x=>x==='identity-delete').length,1);
});

test('cleanup failure remains pending with content references, then resumes without provider credentials',async t=>{
  const f=setup(t),remove=f.kv.delete;f.kv.delete=async()=>{throw Error('private KV diagnostic');};
  const first=await f.run();assert.equal(first.code,'cleanup_pending');assert.equal(first.identityRemoved,true);
  assert.equal((await f.row()).phase,'identity_removed');assert.equal(await f.count('users'),1);assert.equal(await f.count('account_deletion_notifications'),0);
  f.kv.delete=remove;delete f.env.STRIPE_SECRET_KEY;delete f.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const count=f.stub.calls.length;assert.equal((await f.run()).status,'complete');assert.equal(f.stub.calls.length,count);
  assert.equal(await f.count('account_deletion_notifications'),1);
});

test('notification staging failure rolls erasure back so the address is not lost',async t=>{
  const f=setup(t);
  f.db.exec("CREATE TRIGGER deny_notice BEFORE INSERT ON account_deletion_notifications BEGIN SELECT RAISE(ABORT,'fixture outbox failure'); END;");
  const result=await f.run();assert.equal(result.code,'cleanup_pending');assert.equal(await f.count('users'),1);
  assert.equal((await f.row()).email,'owner@example.test');assert.equal((await f.row()).phase,'identity_removed');
  f.db.exec('DROP TRIGGER deny_notice');assert.equal((await f.run()).status,'complete');assert.equal(await f.count('account_deletion_notifications'),1);
});

test('project mismatch and invalid service credentials fail before accepting intent or calling providers',async t=>{
  const f=setup(t);
  for(const config of ['not-json',credentials.replace('fixture-project','another-project'),JSON.stringify({project_id:'fixture-project'})]) {
    f.env.FIREBASE_SERVICE_ACCOUNT_JSON=config;
    await assert.rejects(f.run(),/identity_configuration_invalid/);
    assert.equal(await f.count('account_deletion_admissions'),0);assert.equal(f.stub.calls.length,0);
  }
});

test('missing binding or durable schema refuses destructive work',async t=>{
  const f=setup(t),cache=f.env.JOBHACKAI_KV;delete f.env.JOBHACKAI_KV;
  await assert.rejects(f.run(),/configuration_unavailable/);assert.equal(f.stub.calls.length,0);
  f.env.JOBHACKAI_KV=cache;f.db.exec('DROP TABLE account_deletion_jobs');
  await assert.rejects(f.run(),/no such table/);assert.equal(f.stub.calls.length,0);
});

test('Firebase client pins project and UID, rejects foreign/tenant responses and redacts provider errors',async t=>{
  const f=setup(t),client=await createFirebaseDeletionClient(credentials,'fixture-project');
  assert.equal(await client.exists('owner'),true);
  const call=f.stub.calls.find(x=>x.url.includes('accounts:lookup'));
  assert.equal(call.url,'https://identitytoolkit.googleapis.com/v1/projects/fixture-project/accounts:lookup');
  assert.deepEqual(JSON.parse(call.init.body),{localId:['owner']});
  for(const reply of [{users:[{localId:'other'}]},{users:[{localId:'owner',tenantId:'foreign'}]},{users:'bad'},{users:null},{unexpected:true}]) {
    f.fixture.lookupReply=reply;await assert.rejects(client.exists('owner'),/identity_response_invalid/);
  }
  f.fixture.lookupReply=null;f.fixture.lookupFails=true;
  await assert.rejects(client.exists('owner'),error=>error.message==='identity_request_unconfirmed');
});

test('Firebase activity reads fresh login and refresh times without exposing account data',async t=>{
  const f=setup(t),client=await createFirebaseDeletionClient(credentials,'fixture-project');
  f.fixture.lookupReply={users:[{localId:'owner',lastLoginAt:'1690000000123',
    lastRefreshAt:'2026-09-20T15:01:23.045123456Z',passwordHash:'private-hash',email:'private@example.test'}]};
  assert.deepEqual(await client.activity('owner'),{lastLoginAt:1690000000123,lastRefreshAt:Date.parse('2026-09-20T15:01:23.045Z')});
  f.fixture.lookupReply={users:[{localId:'owner',lastLoginAt:'1789900000000',lastRefreshAt:'2026-09-20T10:01:23-05:00'}]};
  assert.deepEqual(await client.activity('owner'),{lastLoginAt:1789900000000,lastRefreshAt:Date.parse('2026-09-20T15:01:23Z')});
  assert.equal(f.events.filter(event=>event==='lookup').length,2);
  assert.equal(f.events.filter(event=>event==='identity-delete'||event.startsWith('stripe:')).length,0);
});
test('Firebase activity distinguishes missing identity, missing timestamps, and malformed evidence',async t=>{
  const f=setup(t),client=await createFirebaseDeletionClient(credentials,'fixture-project');
  f.fixture.exists=false;assert.equal(await client.activity('owner'),null);
  f.fixture.exists=true;assert.deepEqual(await client.activity('owner'),{lastLoginAt:null,lastRefreshAt:null});
  for(const field of ['lastLoginAt','lastRefreshAt']) {
    const invalid=field==='lastLoginAt'?[null,1690000000123,'-1','1.5','1e12','9007199254740992','8640000000000001']:
      [null,1690000000123,'yesterday','2026-09-20','2026-02-30T01:02:03Z','2026-09-20T24:00:00Z','2026-09-20T10:00:00+99:00'];
    for(const value of invalid) {
      f.fixture.lookupReply={users:[{localId:'owner',[field]:value}]};
      await assert.rejects(client.activity('owner'),error=>error.message==='identity_activity_invalid');
    }
  }
  for(const reply of [{users:null},{users:[{localId:'other'}]},{users:[{localId:'owner',tenantId:'foreign'}]}]) {
    f.fixture.lookupReply=reply;await assert.rejects(client.activity('owner'),/identity_response_invalid/);
  }
  f.fixture.lookupReply=null;f.fixture.lookupFails=true;
  await assert.rejects(client.activity('owner'),error=>error.message==='identity_request_unconfirmed');
});

test('actual request handler uses only verified UID, returns 202 for pending and hides failures',async t=>{
  const f=setup(t);f.fixture.billingFails=true;
  const source=readFileSync(new URL('../../api/user/delete.js',import.meta.url),'utf8');
  const sandbox={Response,processAccountDeletion,getBearer:request=>request.headers.get('authorization'),
    verifyFirebaseIdToken:async token=>{if(token!=='valid')throw Error('private auth');return {uid:'owner',payload:{email:'owner@example.test'}};}};
  vm.createContext(sandbox);vm.runInContext(source.replace(/^import .*;\n/gm,'').replace('export async function','async function')+'\nglobalThis.handler=onRequest;',sandbox);
  const run=token=>sandbox.handler({env:f.env,request:new Request('https://qa.jobhackai.io/api/user/delete',{
    method:'POST',headers:token?{authorization:token}:{},body:JSON.stringify({uid:'other'})})});
  assert.equal((await run(null)).status,401);assert.equal((await run('bad')).status,401);assert.equal(await f.count('account_deletion_admissions'),0);
  const pending=await run('valid');assert.equal(pending.status,202);assert.equal((await pending.json()).status,'pending');
  assert.equal(await f.db.prepare('SELECT auth_id FROM account_deletion_admissions').first('auth_id'),'owner');
  f.env.FIREBASE_SERVICE_ACCOUNT_JSON='private invalid credentials';
  const error=await run('valid');assert.equal(error.status,503);assert.ok(!(await error.text()).includes('private invalid'));
});

test('actual account UI preserves pending sign-in and never labels unfinished cleanup deleted',async()=>{
  const html=readFileSync(new URL('../../../../account-setting.html',import.meta.url),'utf8');
  const marker="document.getElementById('delete-modal-confirm').addEventListener('click', async function() {";
  const body=html.slice(html.indexOf(marker)+marker.length).split('\n      });\n    }\n  </script>')[0];
  for(const [status,removed,signouts] of [['pending',false,0],['pending',null,0],['pending',true,1],['complete',true,1]]) {
    const alerts=[],calls=[],button={},sandbox={alert:text=>alerts.push(text),console:{error(){}},
      localStorage:{clear:()=>calls.push('clear')},window:{location:{href:'unchanged'},FirebaseAuthManager:{
        getCurrentUser:()=>({getIdToken:async()=> 'fixture'}),signOut:async()=>calls.push('signout')}},
      fetch:async()=>Response.json({status,identityRemoved:removed,message:'Pending cleanup',reference:'fixture-reference'},{status:status==='pending'?202:200})};
    vm.createContext(sandbox);vm.runInContext('globalThis.click=async function(){'+body+'};',sandbox);
    await sandbox.click.call(button);assert.equal(calls.filter(x=>x==='signout').length,signouts);
    if(status==='pending') {assert.equal(alerts.length,1);assert.match(alerts[0],/fixture-reference/);}
    if(!signouts){assert.equal(button.textContent,'Check Deletion Status');assert.equal(sandbox.window.location.href,'unchanged');}
  }
});
