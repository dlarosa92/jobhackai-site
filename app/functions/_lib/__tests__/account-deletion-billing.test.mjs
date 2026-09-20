import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { assertStripeKeyMatchesEnvironment, isForeignEnvironmentStamp, canonicalEnvironmentName, canonicalizeEnvironmentStamp } from '../stripe-environment.js';
const source = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const strip = code => code.replace(/^import .*;\n/gm, '').replaceAll('export async function', 'async function').replaceAll('export function', 'function');
const customer = (id, owner='owner') => ({id, metadata:owner ? {firebaseUid:owner}: {}});
const sub = (id, customer='cus_1', status='active') => ({id, customer, status, metadata:{environment:'qa'}});
function setup({ customers=[customer('cus_1')], subscriptions=[sub('sub_1')], mapped='cus_1', override, conflict=false, kvFailure=false }={}) {
  const calls=[];
  const ctx={URL, Set, Map, encodeURIComponent, assertStripeKeyMatchesEnvironment, isForeignEnvironmentStamp, canonicalEnvironmentName, canonicalizeEnvironmentStamp,
    kvCusKey:uid=>'cusByUid:'+uid,
    assertNoCrossUserStripeIds:async()=>({ok:!conflict}),
    stripe:async(_env,path,init={})=>{
      calls.push({path,method:init.method||'GET'});
      const custom=await override?.(path,init,calls);
      if(custom) return custom;
      const url=new URL('https://stripe.test'+path);
      if(init.method==='DELETE') return Response.json({...subscriptions.find(s=>path.endsWith('/'+s.id)),status:'canceled'});
      if(url.pathname==='/customers') return Response.json({data:customers,has_more:false});
      if(url.pathname==='/subscriptions') return Response.json({data:subscriptions.filter(s=>s.customer===url.searchParams.get('customer')),has_more:false});
      return Response.json(customers.find(c=>path.endsWith('/'+c.id))||{}, {status:customers.some(c=>path.endsWith('/'+c.id))?200:404});
    }
  };
  vm.createContext(ctx);vm.runInContext(strip(source('../account-deletion-billing.js'))+'\nglobalThis.guard=cancelBillingBeforeDeletion;',ctx);
  const env={STRIPE_SECRET_KEY:'sk_test_fixture_only',ENVIRONMENT:'qa',JOBHACKAI_KV:{get:async()=>{if(kvFailure)throw Error('cache unavailable');return null;}}};
  const input={uid:'owner',email:'owner@example.test',user:{stripe_customer_id:mapped,email:'owner@example.test'}};
  return {calls,ctx,env,input,run:()=>ctx.guard(env,input)};
}
test('all owned duplicate customers and nonterminal statuses are canceled', async()=>{
  const statuses=['active','trialing','past_due','unpaid','paused','incomplete','canceled','incomplete_expired'];
  const subscriptions=statuses.map((status,i)=>sub('sub_'+i,i%2?'cus_2':'cus_1',status));
  const h=setup({customers:[customer('cus_1'),customer('cus_2')],subscriptions});
  assert.equal((await h.run()).canceledSubscriptions,6);
  assert.equal(h.calls.filter(c=>c.method==='DELETE').length,6);
});
test('customer and subscription pagination both include later pages', async()=>{
  const subscriptions=[sub('sub_1'),sub('sub_2'),sub('sub_3','cus_2')];
  const h=setup({subscriptions,override:path=>{
    const u=new URL('https://x.test'+path);
    if(u.pathname==='/customers') return Response.json({data:[customer(u.searchParams.has('starting_after')?'cus_2':'cus_1')],has_more:!u.searchParams.has('starting_after')});
    if(u.pathname==='/subscriptions'&&u.searchParams.get('customer')==='cus_1')return Response.json({data:[subscriptions[u.searchParams.has('starting_after')?1:0]],has_more:!u.searchParams.has('starting_after')});
  }});
  assert.equal((await h.run()).canceledSubscriptions,3);
  assert.ok(h.calls.some(c=>c.path.includes('starting_after=cus_1')));
  assert.ok(h.calls.some(c=>c.path.includes('starting_after=sub_1')));
});
for(const [name,options] of [
  ['customer lookup fails',{override:path=>path.startsWith('/customers/')?new Response('',{status:503}):null}],
  ['subscription lookup fails',{override:path=>path.startsWith('/subscriptions?')?new Response('',{status:503}):null}],
  ['mapped customer belongs to another user',{customers:[customer('cus_1','other')]}],
  ['email-only active customer has no ownership',{customers:[customer('cus_1',null)],mapped:null}],
  ['database ownership conflicts',{conflict:true}],
  ['cache lookup fails',{kvFailure:true}],
  ['subscription ownership conflicts',{subscriptions:[{...sub('sub_1'),metadata:{firebaseUid:'other',environment:'qa'}}]}],
  ['unknown subscription state',{subscriptions:[sub('sub_1','cus_1','new_unknown_state')]}],
  ['malformed pagination',{override:path=>path.startsWith('/customers?')?Response.json({data:[],has_more:true}):null}],
])test(name+' leaves every subscription untouched',async()=>{
  const h=setup(options);await assert.rejects(h.run());assert.equal(h.calls.filter(c=>c.method==='DELETE').length,0);
});
test('different explicitly owned email match is never canceled', async()=>{
  const h=setup({customers:[customer('cus_1'),customer('cus_other','other')],subscriptions:[sub('sub_1'),sub('sub_other','cus_other')]});
  assert.equal((await h.run()).canceledSubscriptions,1);assert.ok(!h.calls.some(c=>c.path.includes('cus_other')||c.path.includes('sub_other')));
});
test('a cancellation HTTP failure or success without canceled status cannot pass', async()=>{
  for(const response of [new Response('',{status:500}),Response.json(sub('sub_1'))]) {
    const h=setup({override:(_path,init)=>init.method==='DELETE'?response:null});await assert.rejects(h.run());
  }
});
test('no billing credential fails before a lookup',async()=>{const h=setup();delete h.env.STRIPE_SECRET_KEY;await assert.rejects(h.run());assert.equal(h.calls.length,0);});

test('missing or unusable cache cannot be treated as an empty billing history',async()=>{
  for(const cache of [undefined,null,{}, {get:null}]) {
    const h=setup({customers:[],subscriptions:[],mapped:null});
    h.env.JOBHACKAI_KV=cache;
    await assert.rejects(h.run(),/Billing cache unavailable/);
    assert.equal(h.calls.length,0);
  }
});

function routeHarness({billingFails=false,firebaseFails=false,clientFallback=false,kvFails=false}={}) {
  const events=[];let emailOptions;
  const ctx={Request,Response,Date,console:{log(){},warn(){},error(){}},
    getBearer:()=> 'token',verifyFirebaseIdToken:async()=>({uid:'owner',payload:{email:'owner@example.test'}}),
    getDb:()=>({prepare:sql=>({bind:()=>({first:async()=>({id:1,email:'owner@example.test'}),all:async()=>({results:[]}),run:async()=>{events.push('db-cleanup');return {meta:{changes:1}};}})})}),
    cancelBillingBeforeDeletion:async()=>{events.push('billing');if(billingFails)throw Error('unavailable');},
    deleteFirebaseAuthUserAdmin:async()=>{events.push('firebase');return {ok:!firebaseFails,error:firebaseFails?'fixture admin failure':undefined};},
    fetch:async()=>{events.push('firebase-client');return new Response('',{status:200});},
    invalidateBillingCaches:async()=>{},writeDeletedTombstone:async()=>{events.push('tombstone');return true;},
    accountDeletedEmail:(_email,options)=>{emailOptions=options;return {subject:'fixture',html:'fixture'};},
    sendEmail:async()=>{events.push('email');return {ok:true};}
  };
  vm.createContext(ctx);vm.runInContext(strip(source('../../api/user/delete.js'))+'\nglobalThis.handler=onRequest;',ctx);
  return {events,get emailOptions(){return emailOptions;},run:()=>ctx.handler({request:new Request('https://qa.jobhackai.io/api/user/delete',{method:'POST'}),env:{FIREBASE_SERVICE_ACCOUNT_JSON:'fixture',...(clientFallback?{FIREBASE_WEB_API_KEY:'fixture'}:{}),JOBHACKAI_KV:{delete:async()=>{events.push('kv');if(kvFails)throw Error('unavailable');},put:async()=>events.push('kv-tombstone')}}})};
}
test('route preserves Firebase and data when billing fails',async()=>{
  const h=routeHarness({billingFails:true});const r=await h.run();assert.equal(r.status,503);assert.deepEqual(h.events,['billing']);assert.match((await r.json()).error,/Some subscriptions may already be canceled/);
});
test('Firebase failure reports already completed billing cancellation accurately',async()=>{
  const h=routeHarness({firebaseFails:true});const r=await h.run();assert.equal(r.status,500);assert.deepEqual(h.events,['billing','firebase']);assert.match((await r.json()).error,/Subscription cancellation has completed/);
});
test('email waits for cleanup and discloses a KV cleanup failure',async()=>{
  const h=routeHarness({kvFails:true});const r=await h.run();assert.equal(r.status,200);assert.equal(h.emailOptions.cleanupPending,true);assert.equal(h.events.at(-1),'email');assert.ok(h.events.indexOf('billing')<h.events.indexOf('firebase'));assert.match((await r.json()).message,/follow-up/);
});
test('completed cleanup email is also sent after tombstones',async()=>{
  const h=routeHarness();assert.equal((await h.run()).status,200);assert.equal(h.emailOptions.cleanupPending,false);assert.equal(h.events.at(-1),'email');assert.ok(h.events.indexOf('kv-tombstone')<h.events.indexOf('email'));
});

test('partial cancellation failure stops before further cancellation and can be retried',async()=>{
  let failedOnce=false;
  const subscriptions=[sub('sub_1'),sub('sub_2')];
  const h=setup({subscriptions,override:(path,init)=>{
    if(init.method==='DELETE'&&path.endsWith('sub_1')) subscriptions[0].status='canceled';
    if(init.method==='DELETE'&&path.endsWith('sub_2')&&!failedOnce){failedOnce=true;return new Response('',{status:503});}
  }});
  await assert.rejects(h.run());assert.equal((await h.run()).canceledSubscriptions,1);
  assert.equal(h.calls.filter(c=>c.method==='DELETE'&&c.path.endsWith('sub_1')).length,1);
});
test('later ambiguous customer aborts before canceling an earlier owned customer',async()=>{
  const h=setup({customers:[customer('cus_1'),customer('cus_2',null)],subscriptions:[sub('sub_1'),sub('sub_2','cus_2')]});
  await assert.rejects(h.run());assert.equal(h.calls.filter(c=>c.method==='DELETE').length,0);
});

test('wrong or unknown Stripe mode never performs a billing request',async()=>{
  for(const [environment,key] of [['qa','sk_live_fixture'],['dev','rk_live_fixture'],['production','sk_test_fixture'],['','sk_test_fixture'],['unknown','sk_test_fixture']]){
    const h=setup();h.env.ENVIRONMENT=environment;h.env.STRIPE_SECRET_KEY=key;
    await assert.rejects(h.run());assert.equal(h.calls.length,0);
  }
});
test('foreign or unstamped nonproduction subscriptions abort all cancellation',async()=>{
  for(const stamp of ['dev','production','unknown',null]){
    const h=setup({subscriptions:[sub('sub_1'),{...sub('sub_2'),metadata:stamp?{environment:stamp}:{}}]});
    await assert.rejects(h.run());assert.equal(h.calls.filter(c=>c.method==='DELETE').length,0);
  }
});
test('production retains legacy unstamped support with a matching live key',async()=>{
  const h=setup({subscriptions:[{...sub('sub_1'),metadata:{}}]});
  h.env.ENVIRONMENT='PROD';h.env.STRIPE_SECRET_KEY='rk_live_fixture_only';
  assert.equal((await h.run()).canceledSubscriptions,1);
});

test('successful Firebase fallback clears recovered auth failure from cleanup status',async()=>{
  const h=routeHarness({firebaseFails:true,clientFallback:true});
  const response=await h.run(),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.warnings,undefined);
  assert.equal(h.emailOptions.cleanupPending,false);assert.ok(h.events.includes('firebase-client'));
  assert.equal(body.message,'Account sign-in access removed');
});
