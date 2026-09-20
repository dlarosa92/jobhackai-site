import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { withAccountOperation, queueAccountWork, accountOperationEnv } from '../account-operation-scope.js';
import { stripe } from '../billing-utils.js';
import { beginDeletionAdmission, assertDeletionQuiescent } from '../account-deletion-admission.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(t, path = '/api/stripe-checkout', token = 'valid', method = 'POST') {
  const db = sqliteD1(); t.after(() => db.close());
  db.exec(readFileSync(new URL('../../../db/migrations/028_account_deletion_recovery.sql', import.meta.url), 'utf8'));
  const waits = [];
  const context = {
    env: { JOBHACKAI_DB: db, FIREBASE_PROJECT_ID: 'fixture' }, data: {},
    request: new Request('https://qa.jobhackai.io' + path, { method,
      headers: token ? { Authorization: 'Bearer ' + token } : {} }),
    waitUntil(promise) { waits.push(promise); void promise.catch(() => {}); }
  };
  return { db, context, waits,
    state: () => db.prepare("SELECT state FROM account_operation_claims WHERE auth_id='owner' ORDER BY rowid DESC LIMIT 1").first('state'),
    count: () => db.prepare('SELECT COUNT(*) AS n FROM account_operation_claims').first('n'),
    flush: async () => { let i=0; while (i<waits.length) await Promise.allSettled(waits.slice(i, i=waits.length)); }
  };
}
function middleware() {
  const source = readFileSync(new URL('../../api/_middleware.js', import.meta.url), 'utf8');
  const sandbox = { URL, Response, Set, withAccountOperation,
    getBearer: request => request.headers.get('Authorization')?.replace(/^Bearer /, ''),
    verifyFirebaseIdToken: async token => {
      if (token !== 'valid') throw Error('private token diagnostic');
      return { uid: 'owner' };
    } };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace('export async function', 'async function') + '\nglobalThis.handler=onRequest;', sandbox);
  return sandbox.handler;
}

test('actual API middleware prevents both checkout routes and signed-in GET writers after deletion intent', async t => {
  for (const [path, method] of [['/api/stripe-checkout','POST'], ['/api/upgrade-plan','POST'], ['/api/plan/me','GET']]) {
    const f = setup(t, path, 'valid', method);
    await beginDeletionAdmission(f.context.env, { uid:'owner' });
    let called = false; f.context.next = async () => { called = true; return new Response('unsafe'); };
    const result = await middleware()(f.context);
    assert.equal(result.status, 409); assert.equal(called, false); assert.equal(await f.count(), 0);
  }
});
test('an admitted foreground writer holds deletion until its handler actually finishes', async t => {
  const f = setup(t), entered = deferred(), release = deferred();
  f.context.next = async () => { entered.resolve(); await release.promise; return new Response('ok'); };
  const request = middleware()(f.context); await entered.promise;
  await beginDeletionAdmission(f.context.env, { uid:'owner' });
  await assert.rejects(assertDeletionQuiescent(f.context.env,'owner'), /operations_pending/);
  release.resolve(); assert.equal((await request).status,200);
  assert.equal(await f.state(),'finished'); assert.ok(await assertDeletionQuiescent(f.context.env,'owner'));
});
test('child Pages context background work holds the claim beyond HTTP response completion', async t => {
  const f = setup(t), release = deferred();
  f.context.next = async () => {
    const child = { ...f.context, data:f.context.data };
    queueAccountWork(child, () => release.promise);
    return Response.json({ status:'completed' });
  };
  assert.equal((await middleware()(f.context)).status,200);
  await beginDeletionAdmission(f.context.env,{uid:'owner'});
  assert.equal(await f.state(),'active');
  await assert.rejects(assertDeletionQuiescent(f.context.env,'owner'), /operations_pending/);
  release.resolve(); await f.flush();
  assert.equal(await f.state(),'finished'); assert.ok(await assertDeletionQuiescent(f.context.env,'owner'));
});
test('nested background work is drained before a claim can finish', async t => {
  const f = setup(t), first = deferred(), second = deferred();
  await withAccountOperation(f.context,'owner',async () => {
    queueAccountWork(f.context,async () => { await first.promise; queueAccountWork(f.context,() => second.promise); });
    return new Response('ok');
  });
  first.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await f.state(),'active'); second.resolve(); await f.flush();
  assert.equal(await f.state(),'finished');
});
test('failed background work leaves durable uncertainty even after a successful HTTP response', async t => {
  const f = setup(t), release = deferred();
  await withAccountOperation(f.context,'owner',async () => {
    queueAccountWork(f.context, () => release.promise); return new Response('ok');
  });
  release.reject(Error('private provider detail')); await f.flush();
  assert.equal(await f.state(),'uncertain');
  await beginDeletionAdmission(f.context.env,{uid:'owner'});
  await assert.rejects(assertDeletionQuiescent(f.context.env,'owner'), /operations_pending/);
});
test('server failures and thrown handlers never become finished claims or leak diagnostics', async t => {
  for (const handler of [async()=>new Response('failed',{status:502}), async()=>{throw Error('private customer credential');}]) {
    const f=setup(t); f.context.next=handler;
    const result=await middleware()(f.context);
    assert.ok(result.status>=500); assert.equal(await f.state(),'uncertain');
    assert.ok(!(await result.text()).includes('private customer credential'));
  }
});
test('work cannot start after settlement, including a synchronous factory side effect', async t => {
  const f=setup(t); await withAccountOperation(f.context,'owner',async()=>new Response('ok'));
  let started=false;
  assert.throws(()=>queueAccountWork(f.context,()=>{started=true;}), /operation_closed/);
  assert.equal(started,false);
});
test('invalid identity and missing schema stop protected handlers before writes', async t => {
  const bad=setup(t,'/api/upgrade-plan','invalid'); bad.context.next=()=>{throw Error('must not run');};
  const response=await middleware()(bad.context); assert.equal(response.status,401); assert.equal(await bad.count(),0);
  assert.ok(!(await response.text()).includes('private token'));
  const missing=setup(t); missing.db.exec('DROP TABLE account_operation_claims');
  missing.context.next=()=>{throw Error('must not run');};
  const unavailable=await middleware()(missing.context);
  assert.equal(unavailable.status,503); assert.ok(!(await unavailable.text()).includes('SQL'));
});
test('deletion retries, public callbacks and OPTIONS retain their own admission/authentication paths', async t => {
  for (const [path, token, method] of [['/api/user/delete/','valid','POST'], ['/api/stripe-webhook',null,'POST'], ['/api/stripe-checkout',null,'OPTIONS']]) {
    const f=setup(t,path,token,method); f.context.next=async()=>new Response('own auth');
    assert.equal((await middleware()(f.context)).status,200); assert.equal(await f.count(),0);
  }
});
test('failure to record settlement leaves an active claim for recovery', async t => {
  const f=setup(t);
  f.db.exec("CREATE TRIGGER deny_claim_settlement BEFORE UPDATE ON account_operation_claims BEGIN SELECT RAISE(ABORT,'private storage outage'); END;");
  f.context.next=async()=>new Response('ok');
  const result=await middleware()(f.context); assert.equal(result.status,503); assert.equal(await f.state(),'active');
  assert.ok(!(await result.text()).includes('private storage'));
});
test('one account deletion does not block another verified account', async t => {
  const f=setup(t); await beginDeletionAdmission(f.context.env,{uid:'other'});
  assert.equal((await withAccountOperation(f.context,'owner',async()=>new Response('ok'))).status,200);
  assert.equal(await f.state(),'finished');
});

test('actual Stripe adapter preserves uncertainty when a handler swallows a timeout or maps provider 5xx to 400', async t => {
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});
  for (const status of ['timeout',503,429]) {
    const f=setup(t); f.context.env.STRIPE_SECRET_KEY='sk_test_fixture';
    globalThis.fetch=async()=>{if(status==='timeout')throw Error('private provider timeout');return new Response('',{status});};
    await withAccountOperation(f.context,'owner',async()=>{
      const env=accountOperationEnv(f.context);
      try { await stripe(env,'/checkout/sessions',{method:'POST'}); } catch (_) { /* existing endpoint catch */ }
      return new Response('masked failure',{status:status===503?400:200});
    },'billing');
    await f.flush(); assert.equal(await f.state(),'uncertain');
    await beginDeletionAdmission(f.context.env,{uid:'owner'});
    await assert.rejects(assertDeletionQuiescent(f.context.env,'owner'),/operations_pending/);
  }
});
test('successful and definitively rejected Stripe writes settle; observers never mutate shared env', async t => {
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});
  for (const status of [200,400]) {
    const f=setup(t); f.context.env.STRIPE_SECRET_KEY='sk_test_fixture';
    const keys=Reflect.ownKeys(f.context.env);
    globalThis.fetch=async()=>new Response('',{status});
    let observed;
    await withAccountOperation(f.context,'owner',async()=>{
      observed=accountOperationEnv(f.context);
      await stripe(observed,'/subscriptions/sub_fixture',{method:'DELETE'});
      return new Response('done',{status});
    },'billing');
    await f.flush(); assert.equal(await f.state(),'finished');
    assert.deepEqual(Reflect.ownKeys(f.context.env),keys); assert.notEqual(observed,f.context.env);
    let called=false; globalThis.fetch=async()=>{called=true; return new Response('unsafe');};
    assert.throws(()=>stripe(observed,'/customers',{method:'POST'}),/operation_closed/);
    assert.equal(called,false);
  }
});
test('actual voice completion cannot release admission before the delayed scorecard write', async t => {
  const f=setup(t,'/api/voice/session/own/complete');
  f.db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,auth_id TEXT); INSERT INTO users VALUES(1,'owner')");
  for (const name of ['020_add_voice_entitlements.sql','021_add_voice_end_reason.sql','029_voice_usage_evidence.sql']) {
    f.db.exec(readFileSync(new URL('../../../db/migrations/'+name,import.meta.url),'utf8'));
  }
  f.db.exec("INSERT INTO voice_sessions(id,user_id,status,entitlement_mode) VALUES('own',1,'active','free')");
  const release=deferred();
  const source=readFileSync(new URL('../../api/voice/session/[id]/complete.js',import.meta.url),'utf8');
  const sandbox={queueAccountWork,Response,console:{log(){},warn(){},error(){}},
    getBearer:()=> 'valid', verifyFirebaseIdToken:async()=>({uid:'owner'}),
    getDb:()=>f.db,getOrCreateUserByAuthId:async()=>({id:1}),voiceFeatureEnabled:()=>true,
    generateRequestId:()=> 'fixture',normalizeEndReason:()=> 'user_ended',shouldGenerateScorecard:()=>true,
    normalizeVoiceUsage:()=>null,responseTokenTotals:()=>({input:null,output:null}),
    successResponse:(body,status)=>Response.json(body,{status}),errorResponse:(error,status)=>Response.json({error},{status}),
    generateAndStoreScorecard:async()=>{await release.promise;await f.db.prepare("UPDATE voice_sessions SET scorecard_json='fixture report' WHERE id='own'").run();}
  };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/^import .*;\n/gm,'').replace('export async function','async function')+'\nglobalThis.handler=onRequest',sandbox);
  f.context.request=new Request(f.context.request.url,{method:'POST',headers:{Authorization:'Bearer valid'},body:JSON.stringify({transcript:[]})});
  f.context.next=()=>sandbox.handler({...f.context,params:{id:'own'}});
  assert.equal((await middleware()(f.context)).status,200);
  assert.equal(await f.db.prepare("SELECT status FROM voice_sessions WHERE id='own'").first('status'),'completed');
  assert.equal(await f.state(),'active');
  await beginDeletionAdmission(f.context.env,{uid:'owner'});
  await assert.rejects(assertDeletionQuiescent(f.context.env,'owner'),/operations_pending/);
  release.resolve(); await f.flush();
  assert.equal(await f.db.prepare("SELECT scorecard_json FROM voice_sessions WHERE id='own'").first('scorecard_json'),'fixture report');
  assert.equal(await f.state(),'finished');
});
