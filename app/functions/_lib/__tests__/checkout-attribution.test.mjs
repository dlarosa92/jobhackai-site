import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { normalizeCheckoutAnalytics, saveCheckoutAttribution, revokeCheckoutAttribution } from '../checkout-attribution.js';
const clientId = '7bbba230-b755-4d31-b475-e20cf6d00ed9';
const otherClient = '6bbba230-b755-4d31-b475-e20cf6d00ed9';
const migration = readFileSync(new URL('../../../db/migrations/025_checkout_attribution.sql', import.meta.url), 'utf8');
function setup(t) {
  const db=sqliteD1();t.after(()=>db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,auth_id TEXT);
    INSERT INTO users VALUES(42,'owner'),(43,'other');
    CREATE TABLE cookie_consents(id INTEGER PRIMARY KEY,user_id INTEGER,client_id TEXT,consent_json TEXT);
    INSERT INTO cookie_consents(user_id,consent_json) VALUES(42,'{"version":1,"analytics":true}');`);
  db.exec(migration);
  const env={DB:db,ENVIRONMENT:'qa'};
  const touch={at:Date.now()-1000,source:'linkedin',medium:'organic_social',campaign:'voice_beta_2026_09',asset:'intro_01'};
  const input={request:new Request('https://qa.jobhackai.io/api/stripe-checkout',{headers:{Cookie:'jha_client_id='+clientId}}),
    session:{id:'cs_test_one',status:'open',customer:'cus_owner'},uid:'owner',customerId:'cus_owner',
    analytics:{analyticsConsent:true,gaClientId:'1234.5678',gaSessionId:'9876',firstTouch:touch,lastTouch:touch}};
  return {db,env,input,save:(overrides={})=>saveCheckoutAttribution(env,{...input,...overrides}),
    rows:async()=> (await db.prepare('SELECT * FROM checkout_attributions').all()).results};
}
test('authenticated grant saves bounded campaign fields and real GA IDs once per checkout',async t=>{
  const h=setup(t);h.input.analytics.email='must-not-persist@example.com';h.input.analytics.firstTouch.url='must-not-persist';
  assert.equal(await h.save(),true);
  const original=(await h.rows())[0];
  assert.equal(original.user_id,42);assert.equal(original.ga_client_id,'1234.5678');assert.equal(original.environment,'qa');
  assert.equal(JSON.stringify(original).includes('must-not-persist'),false);
  h.input.analytics.lastTouch.campaign='replacement';assert.equal(await h.save(),false);
  assert.deepEqual((await h.rows())[0],original);
});
test('browser assertion cannot replace account consent, identity, or an open owned checkout',async t=>{
  const h=setup(t);
  for (const overrides of [{uid:'other'},{analytics:{analyticsConsent:false}},{session:{...h.input.session,status:'complete'}},
    {session:{...h.input.session,customer:'cus_other'}},{request:new Request('https://qa.jobhackai.io/') }]) {
    assert.equal(await h.save(overrides),false);
  }
  for (const value of ['{"version":1,"analytics":false}','{"version":1,"analytics":"true"}','{"analytics":true}','null','bad-json']) {
    await h.db.prepare('UPDATE cookie_consents SET consent_json=? WHERE user_id=42').bind(value).run();
    assert.equal(await h.save(),false);
  }
  assert.equal((await h.rows()).length,0);
});
test('anonymous rejection and corrupt decisions veto an account grant',async t=>{
  const h=setup(t);
  for (const value of ['{"version":1,"analytics":false}','{}','{"analytics":true}','{"version":2,"analytics":true}','bad-json']) {
    await h.db.prepare('DELETE FROM cookie_consents WHERE client_id=?').bind(clientId).run();
    await h.db.prepare('INSERT INTO cookie_consents(client_id,consent_json) VALUES(?,?)').bind(clientId,value).run();
    assert.equal(await h.save(),false,value);
  }
  await h.db.prepare('UPDATE cookie_consents SET consent_json=? WHERE client_id=?').bind('{"version":1,"analytics":true}',clientId).run();
  assert.equal(await h.save(),true);
});
test('blocked GA stays absent; invalid and expired tags remain unattributed',async t=>{
  const h=setup(t);h.input.analytics={analyticsConsent:true,gaClientId:'firebase-user',gaSessionId:'invented',
    firstTouch:{...h.input.analytics.firstTouch,at:Date.now()-91*86400000},
    lastTouch:{...h.input.analytics.lastTouch,campaign:'someone@example.com'}};
  assert.equal(await h.save(),true);
  const row=(await h.rows())[0];
  for(const key of ['ga_client_id','ga_session_id','first_touch_json','last_touch_json']) assert.equal(row[key],null);
});
test('signed-out withdrawal erases browser contexts; account withdrawal erases all its contexts',async t=>{
  const h=setup(t);assert.equal(await h.save(),true);
  await h.db.prepare('INSERT INTO cookie_consents(user_id,consent_json) VALUES(43,?)').bind('{"version":1,"analytics":true}').run();
  assert.equal(await h.save({uid:'other',session:{...h.input.session,id:'cs_other_account'}}),true);
  assert.equal(await h.save({session:{...h.input.session,id:'cs_other_browser'},request:new Request('https://qa.jobhackai.io/',{headers:{Cookie:'jha_client_id='+otherClient}})}),true);
  h.db.exec('CREATE TABLE financial_record(amount INTEGER); INSERT INTO financial_record VALUES(3900);');
  await revokeCheckoutAttribution(h.env,{clientId});
  assert.deepEqual((await h.rows()).map(r=>r.checkout_session_id),['cs_other_browser']);
  await revokeCheckoutAttribution(h.env,{userId:42});assert.equal((await h.rows()).length,0);
  assert.equal(await h.db.prepare('SELECT amount FROM financial_record').first('amount'),3900);
});
test('unknown environments, malformed consent, and unavailable storage never imply attribution',async t=>{
  const h=setup(t);h.env.ENVIRONMENT='unknown';assert.equal(await h.save(),false);
  assert.equal(normalizeCheckoutAnalytics({analyticsConsent:'true'}),null);
  h.env.ENVIRONMENT='qa';h.db.exec('DROP TABLE checkout_attributions;');assert.equal(await h.save(),false);
});
