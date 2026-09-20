// Run against an actual `wrangler pages functions build` output. This verifies
// Pages routing, middleware order, shared context.data and real JWT verification.
// All provider requests are intercepted; no credentials or live services used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { beginDeletionAdmission } from '../account-deletion-admission.js';

if (!globalThis.crypto) globalThis.crypto=webcrypto;
const bundle=process.env.JOBHACKAI_FUNCTIONS_BUNDLE;
if (!bundle) throw Error('Set JOBHACKAI_FUNCTIONS_BUNDLE to the freshly compiled Pages Worker');
const worker=(await import(pathToFileURL(bundle).href)).default;
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'local-fixture',alg:'RS256',use:'sig'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const now=Math.floor(Date.now()/1000);
const unsigned=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({sub:'owner',user_id:'owner',aud:'fixture',iss:'https://securetoken.google.com/fixture',iat:now,exp:now+600});
const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(unsigned));
const token=unsigned+'.'+Buffer.from(signature).toString('base64url');

test('compiled Pages Worker enforces admission before real checkout handlers and preserves security headers',async t=>{
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  const calls=[];
  globalThis.fetch=async input=>{
    const url=String(input instanceof Request?input.url:input);calls.push(url);
    assert.equal(url,'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com','no live provider requests allowed');
    return Response.json({keys:[jwk]});
  };
  const db=sqliteD1();t.after(()=>db.close());
  db.exec(readFileSync(new URL('../../../db/migrations/028_account_deletion_recovery.sql',import.meta.url),'utf8'));
  const env={JOBHACKAI_DB:db,FIREBASE_PROJECT_ID:'fixture',ENVIRONMENT:'qa',STRIPE_SECRET_KEY:'sk_test_fixture',FRONTEND_URL:'https://qa.jobhackai.io',ASSETS:{fetch:async()=>new Response('fixture asset')}};
  const waits=[];
  const context={waitUntil(p){waits.push(p);},passThroughOnException(){throw Error('fail open forbidden');}};
  const run=(path,bearer=token,method='POST')=>worker.fetch(new Request('https://qa.jobhackai.io'+path,{method,headers:{Authorization:'Bearer '+bearer},...(method==='POST'?{body:'{}'}:{})}),env,context);
  const before=await run('/api/stripe-checkout');
  assert.equal(before.status,422,await before.clone().text());
  assert.equal(await db.prepare("SELECT state FROM account_operation_claims WHERE auth_id='owner'").first('state'),'finished');
  await beginDeletionAdmission(env,{origin:'user_request',uid:'owner'});
  for (const [path,method] of [['/api/stripe-checkout','POST'],['/api/upgrade-plan','POST'],['/api/plan/me','GET']]) {
    const result=await run(path,token,method);
    assert.equal(result.status,409);assert.equal((await result.json()).error,'account_deletion_pending');
    assert.equal(result.headers.get('x-qa-mw'),'hit');
    assert.match(result.headers.get('cache-control'),/no-store/);
    assert.equal(result.headers.get('x-content-type-options'),'nosniff');
  }
  assert.equal((await run('/api/upgrade-plan','invalid')).status,401);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM account_operation_claims').first('n'),1);
  assert.equal(calls.length,1,'real verifier uses one fixture JWKS fetch and no Stripe request');
  await Promise.all(waits);
});

test('compiled deletion route verifies JWT and runs durable cleanup without admitting itself as account work',async t=>{
  const db=sqliteD1();t.after(()=>db.close());
  const sql=name=>readFileSync(new URL('../../../db/'+name,import.meta.url),'utf8');
  db.exec(sql('schema.sql'));
  for(const name of ['002_add_feature_daily_usage','006_linkedin_runs','008_add_cookie_consents','009_role_templates',
    '024_collected_payments','025_checkout_attribution','026_payment_campaign_links','027_analytics_delivery','028_account_deletion_recovery']) {
    db.exec(sql('migrations/'+name+'.sql'));
  }
  const cover=readFileSync(new URL('../../api/cover-letter/generate.js',import.meta.url),'utf8');
  db.exec(cover.match(/`(CREATE TABLE IF NOT EXISTS cover_letter_history[\s\S]+?)`/)[1]);
  db.exec("INSERT INTO users(id,auth_id,email) VALUES(1,'owner','owner@example.test')");
  const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
  let exists=true;const calls=[],originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async(input,init={})=>{
    const url=String(input instanceof Request?input.url:input);calls.push(url);
    if(url==='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')return Response.json({keys:[jwk]});
    if(url.startsWith('https://api.stripe.com/v1/customers?'))return Response.json({data:[],has_more:false});
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-admin-token'});
    if(url==='https://identitytoolkit.googleapis.com/v1/projects/fixture/accounts:lookup') {
      assert.deepEqual(JSON.parse(init.body),{localId:['owner']});return Response.json(exists?{users:[{localId:'owner'}]}:{});
    }
    if(url==='https://identitytoolkit.googleapis.com/v1/projects/fixture/accounts:delete') {
      assert.deepEqual(JSON.parse(init.body),{localId:'owner'});
      assert.equal(await db.prepare('SELECT phase FROM account_deletion_jobs').first('phase'),'billing_verified');
      exists=false;return Response.json({});
    }
    throw Error('Unexpected fixture request: '+url);
  };
  const env={DB:db,JOBHACKAI_KV:{get:async()=>null,delete:async()=>{}},FIREBASE_PROJECT_ID:'fixture',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'fixture',client_email:'fixture@fixture.iam.gserviceaccount.com',private_key:pem}),
    ENVIRONMENT:'qa',STRIPE_SECRET_KEY:'sk_test_fixture',FRONTEND_URL:'https://qa.jobhackai.io',ASSETS:{fetch:async()=>new Response('fixture asset')}};
  const context={waitUntil(){throw Error('Deletion must persist before answering');},passThroughOnException(){throw Error('fail open forbidden');}};
  const response=await worker.fetch(new Request('https://qa.jobhackai.io/api/user/delete',{
    method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({uid:'other'})
  }),env,context);
  assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'complete');
  assert.equal(response.headers.get('x-qa-mw'),'hit');assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM users').first('n'),0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM account_operation_claims').first('n'),0);
  assert.equal(await db.prepare('SELECT state FROM account_deletion_notifications').first('state'),'pending');
  assert.equal(calls.filter(url=>url.endsWith('accounts:delete')).length,1);
});
