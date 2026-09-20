import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
const route = readFileSync(new URL('../../api/user/export.js', import.meta.url), 'utf8');
function setup(t) {
  const db = sqliteD1(); t.after(() => db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,auth_id TEXT,email TEXT,plan TEXT,created_at TEXT,updated_at TEXT,last_login_at TEXT,last_activity_at TEXT);
    INSERT INTO users VALUES(1,'owner','owner@example.test','free',NULL,NULL,NULL,NULL),(2,'other','other@example.test','monthly',NULL,NULL,NULL,NULL);`);
  for (const name of ['020_add_voice_entitlements.sql','021_add_voice_end_reason.sql','024_collected_payments.sql','025_checkout_attribution.sql','026_payment_campaign_links.sql','027_analytics_delivery.sql']) {
    db.exec(readFileSync(new URL('../../../db/migrations/'+name,import.meta.url),'utf8'));
  }
  db.exec(`INSERT INTO voice_sessions(id,user_id,status,entitlement_mode,transcript_json,scorecard_json,jd_excerpt,started_at)
      VALUES('own-voice',1,'completed','free','own transcript','own feedback','own job description','2000-01-01'),
            ('other-voice',2,'completed','subscription','private other transcript','private other feedback','private other JD','2000-01-01');
    INSERT INTO checkout_attributions(checkout_session_id,user_id,client_id,stripe_customer_id,environment,ga_client_id,first_touch_json,captured_at,expires_at)
      VALUES('own-checkout',1,'own-client','own-customer','qa','own-ga','{"campaign":"own-campaign"}',1,2),
            ('other-checkout',2,'other-client','other-customer','qa','other-ga','{"campaign":"private other campaign"}',1,2);
    INSERT INTO stripe_collected_payments(charge_id,payment_intent_id,customer_id,environment,livemode,currency,amount_captured,charge_created_at,first_event_id,last_event_id)
      VALUES('own-charge','own-intent','own-customer','qa',0,'usd',1700,1,'own-event','own-event'),
            ('other-charge','other-intent','other-customer','qa',0,'usd',3400,1,'other-event','other-event');
    INSERT INTO analytics_delivery(event_key,charge_id,checkout_session_id,event_name,event_at,state,created_at,updated_at)
      VALUES('own-key','own-charge','own-checkout','purchase',1,'accepted_unverified',1,1),
            ('other-key','other-charge','other-checkout','purchase',2,'pending',2,2);`);
  let queries = 0;
  const tracked = { prepare(sql) { queries++; return db.prepare(sql); } };
  const ctx = { Request, Response, Date, console:{error(){},warn(){}},
    getBearer:r=>r.headers.get('Authorization')?.replace(/^Bearer /,''),
    verifyFirebaseIdToken:async token=>{if(token!=='valid-owner')throw Error('secret verifier detail');return {uid:'owner'};},
    getDb:()=>tracked
  };
  vm.createContext(ctx);
  vm.runInContext(route.replace(/^import .*;\n/gm,'').replace('export async function onRequest','async function onRequest')+'\nglobalThis.handler=onRequest;',ctx);
  return {db, ctx, get queries(){return queries;},request:(token='valid-owner')=>ctx.handler({env:{},request:new Request('https://qa.jobhackai.io/api/user/export?user_id=2',{headers:token?{Authorization:'Bearer '+token}:{}})})};
}
test('verified owner exports voice and attribution data despite paywall or age; query cannot select another user',async t=>{
  const h=setup(t);const response=await h.request();assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.match(response.headers.get('Content-Disposition'),/attachment/);
  const result=await response.json();
  assert.equal(result.voiceSessions.length,1);assert.equal(result.voiceSessions[0].id,'own-voice');
  assert.equal(result.voiceSessions[0].transcript_json,'own transcript');assert.equal(result.voiceSessions[0].scorecard_json,'own feedback');
  assert.equal(result.checkoutAttributions.length,1);assert.equal(result.checkoutAttributions[0].ga_client_id,'own-ga');
  assert.equal(result.analyticsDelivery.length,1);assert.equal(result.analyticsDelivery[0].state,'accepted_unverified');
  const text=JSON.stringify(result);assert.ok(!text.includes('private other'));assert.ok(!text.includes('other-client'));assert.ok(!text.includes('other-ga'));
  assert.equal(result.voiceSessions[0].cost_usd,undefined);assert.equal(result.checkoutAttributions[0].stripe_customer_id,undefined);
  assert.equal(result.analyticsDelivery[0].event_key,undefined);
});
test('missing or invalid authentication reads no account data',async t=>{
  const h=setup(t);for(const token of [null,'invalid'])assert.equal((await h.request(token)).status,401);
  assert.equal(h.queries,0);
});
test('missing schema is disclosed instead of presented as an empty verified export',async t=>{
  const h=setup(t);h.db.exec('DROP TABLE voice_sessions');
  const result=await (await h.request()).json();
  assert.deepEqual(result.voiceSessions,[]);
  assert.ok(result.unavailableSections.some(x=>x.section==='voice_sessions'&&x.reason==='schema_unavailable'));
});
test('database errors fail the export without leaking internal error details',async t=>{
  const h=setup(t);const original=h.db.prepare.bind(h.db);
  h.db.prepare=sql=>{if(sql.includes('FROM voice_sessions'))throw Error('private database failure');return original(sql);};
  const response=await h.request();assert.equal(response.status,500);assert.ok(!(await response.text()).includes('private'));
});
test('deleted voice and revoked campaign context are absent; FK cascades remove delivery context',async t=>{
  const h=setup(t);h.db.exec("DELETE FROM voice_sessions WHERE user_id=1; DELETE FROM checkout_attributions WHERE user_id=1;");
  const result=await (await h.request()).json();
  assert.deepEqual(result.voiceSessions,[]);assert.deepEqual(result.checkoutAttributions,[]);assert.deepEqual(result.analyticsDelivery,[]);
  assert.equal(await h.db.prepare('SELECT COUNT(*) AS n FROM stripe_collected_payments').first('n'),2);
  assert.equal(await h.db.prepare('SELECT COUNT(*) AS n FROM voice_sessions').first('n'),1);
});
