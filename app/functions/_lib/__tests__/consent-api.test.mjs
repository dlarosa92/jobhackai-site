import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const root = new URL('../../../../',import.meta.url);
const clientId = '7bbba230-b755-4d31-b475-e20cf6d00ed9';
function harness(path, {authFailure=false, userMissing=false, saveFailure=false, stored=null}={}) {
  const writes=[],reads=[];
  const ctx={Request,Response,Date,console:{error(){}},
    getBearer:r=>r.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1],
    verifyFirebaseIdToken:async()=>{if(authFailure)throw Error('private token details');return {uid:'verified-user'};},
    getOrCreateUserByAuthId:async()=>userMissing?null:{id:42},
    getCookieConsent:async(...args)=>{reads.push(args);return stored;},
    upsertCookieConsent:async(_env,row)=>{writes.push(row);return !saveFailure;}
  };
  vm.createContext(ctx);
  const source=readFileSync(new URL(path,root),'utf8').replace(/^import .*;\n/gm,'').replace('export async function onRequest','async function onRequest');
  vm.runInContext(source+'\nglobalThis.handler=onRequest;',ctx);
  return {writes,reads,request:(body,headers={},method='POST')=>ctx.handler({env:{FIREBASE_PROJECT_ID:'qa'},request:new Request('https://qa.jobhackai.io/api/cookie-consent',{method,headers, ...(method==='POST'?{body:JSON.stringify(body)}:{})})})};
}
for(const path of ['app/functions/api/cookie-consent.js','functions/api/cookie-consent.js']) {
  test(path+': invalid signed-in token never reads or writes anonymous consent',async()=>{
    const h=harness(path,{authFailure:true});
    for(const method of ['GET','POST'])assert.equal((await h.request({clientId,consent:{version:1,analytics:false}},{Authorization:'Bearer stale',Cookie:'jha_client_id='+clientId},method)).status,401);
    assert.equal(h.writes.length,0);assert.equal(h.reads.length,0);
  });
  test(path+': malformed auth is rejected even with a valid anonymous identifier',async()=>{
    const h=harness(path);assert.equal((await h.request({clientId,consent:{version:1,analytics:true}},{Authorization:'Basic invalid'})).status,401);assert.equal(h.writes.length,0);
  });
  test(path+': malformed grants are rejected without writes',async()=>{
    const h=harness(path);
    for(const consent of [null,[],true,{version:1,analytics:'false'},{version:1,analytics:1},{version:2,analytics:true},{analytics:true}])assert.equal((await h.request({clientId,consent})).status,400);
    assert.equal(h.writes.length,0);
  });
  test(path+': anonymous grant and rejection retain strict booleans and server receipt time',async()=>{
    const h=harness(path);
    for(const analytics of [true,false]){
      assert.equal((await h.request({clientId,consent:{version:1,analytics,updatedAt:'2099-01-01',email:'must-not-persist'}})).status,200);
      const row=h.writes.at(-1);assert.equal(row.userId,null);assert.equal(row.clientId,clientId);assert.equal(row.consent.analytics,analytics);
      assert.deepEqual(Object.keys(row.consent),['version','analytics','updatedAt']);assert.notEqual(row.consent.updatedAt,'2099-01-01');
    }
  });
  test(path+': signed-in rejection is tied to the verified account',async()=>{
    const h=harness(path);assert.equal((await h.request({consent:{version:1,analytics:false},userId:900},{Authorization:'Bearer valid'})).status,200);
    assert.equal(h.writes[0].userId,42);assert.equal(h.writes[0].authId,'verified-user');assert.equal(h.writes[0].consent.analytics,false);
  });
  test(path+': unresolved authenticated user and failed saves do not report success',async()=>{
    const missing=harness(path,{userMissing:true});assert.equal((await missing.request({clientId,consent:{version:1,analytics:true}},{Authorization:'Bearer valid'})).status,503);assert.equal(missing.writes.length,0);
    const failed=harness(path,{saveFailure:true});const response=await failed.request({clientId,consent:{version:1,analytics:true}});assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,error:'Failed to save consent'});
  });
  test(path+': cookie identity is exact and conflicting or unbounded identifiers are rejected',async()=>{
    const h=harness(path);const consent={version:1,analytics:false};
    for(const value of ['x'.repeat(1000),{},123,''])assert.equal((await h.request({clientId:value,consent})).status,400);
    assert.equal((await h.request({consent},{Cookie:'other_jha_client_id='+clientId})).status,400);
    assert.equal((await h.request({clientId:'6bbba230-b755-4d31-b475-e20cf6d00ed9',consent},{Cookie:'jha_client_id='+clientId})).status,400);
    assert.equal(h.writes.length,0);
    assert.equal((await h.request({consent},{Cookie:'other=a; jha_client_id='+clientId})).status,200);
  });
  test(path+': malformed persisted consent never becomes a grant',async()=>{
    const h=harness(path,{stored:{version:1,analytics:'true'}});const response=await h.request(null,{Cookie:'jha_client_id='+clientId},'GET');assert.deepEqual(await response.json(),{ok:true,consent:null,resetConsent:true});
  });
}

for (const path of ['app/functions/_lib/db.js','functions/_lib/db.js']) {
  test(path+': missing record differs from corrupt or null JSON',async()=>{
    const ctx={console:{error(){}},sanitizeRoleSpecificFeedback:value=>value};vm.createContext(ctx);
    vm.runInContext(readFileSync(new URL(path,root),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.readConsent=getCookieConsent;',ctx);
    for(const row of [null,{consent_json:'not-json'},{consent_json:'null'},{consent_json:''}]){
      const env={DB:{prepare:()=>({bind:()=>({first:async()=>row})})}};
      const value=await ctx.readConsent(env,null,clientId);
      if(row===null)assert.equal(value,null);else {assert.equal(value.analytics,false);assert.equal(value.version,0);}
    }
  });
}
