import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { paymentAttributionStatement, stageCheckoutAttribution } from '../payment-attribution.js';
import { revokeCheckoutAttribution } from '../checkout-attribution.js';
function setup(t) {
  const db=sqliteD1();t.after(()=>db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,auth_id TEXT); INSERT INTO users VALUES(42,'owner');
    CREATE TABLE cookie_consents(user_id INTEGER,client_id TEXT,consent_json TEXT);
    INSERT INTO cookie_consents(user_id,consent_json) VALUES(42,'{"version":1,"analytics":true}');`);
  for (const file of ['024_collected_payments.sql','025_checkout_attribution.sql','026_payment_campaign_links.sql']) db.exec(readFileSync(new URL('../../../db/migrations/'+file,import.meta.url),'utf8'));
  const now=Date.now(),env={DB:db,ENVIRONMENT:'qa'};
  const context=async({id='cs_one',customer='cus_one',environment='qa',sub=null,expires=now+86400000,captured=now-10000}={})=>db.prepare(`INSERT INTO checkout_attributions(checkout_session_id,user_id,client_id,stripe_customer_id,stripe_subscription_id,environment,first_touch_json,last_touch_json,captured_at,expires_at) VALUES(?,42,'7bbba230-b755-4d31-b475-e20cf6d00ed9',?,?,?, ?,?,?,?)`).bind(id,customer,sub,environment,JSON.stringify({source:'linkedin',medium:'organic_social',campaign:'voice_beta'}),JSON.stringify({source:'instagram',medium:'organic_social',campaign:'voice_beta'}),captured,expires).run();
  const payment=async({id='ch_one',session='cs_one',sub=null,customer='cus_one',environment='qa',amount=3900}={})=>db.prepare(`INSERT INTO stripe_collected_payments(charge_id,payment_intent_id,customer_id,checkout_session_id,subscription_id,environment,livemode,currency,amount_captured,charge_created_at,first_event_id,last_event_id) VALUES(?,?,?,?,?,?,0,'usd',?,?, 'evt_one','evt_one')`).bind(id,'pi_'+id,customer,session,sub,environment,amount,Math.floor(now/1000)).run();
  const link=(options={})=>paymentAttributionStatement(db,{environment:'qa',now,...options}).run();
  const rows=async()=> (await db.prepare('SELECT * FROM stripe_campaign_revenue ORDER BY charge_id').all()).results;
  return{db,env,now,context,payment,link,rows};
}
test('a matched payment keeps first and last campaign and refunds subtract only once',async t=>{
  const h=setup(t);await h.context();await h.payment();await h.link();await h.link();
  for(const [id,amount] of [['re_one',100],['re_two',200]])await h.db.prepare("INSERT INTO stripe_payment_refunds(refund_id,charge_id,currency,amount,status,refund_created_at,last_event_id) VALUES(?,'ch_one','usd',?,'succeeded',1,'evt_refund')").bind(id,amount).run();
  const [row]=await h.rows();assert.equal(row.net_collected,3600);assert.equal(row.refunded,300);assert.equal(row.gross_captured,3900);
  assert.equal(row.attribution_status,'consented_checkout');assert.equal(JSON.parse(row.first_touch_json).source,'linkedin');
  assert.equal(await h.db.prepare('SELECT COUNT(*) AS n FROM stripe_payment_attributions').first('n'),1);
});
test('payment arriving before subscription checkout is linked after its verified callback',async t=>{
  const h=setup(t);await h.context();await h.payment({session:null,sub:'sub_one',amount:3400});await h.link();
  assert.equal((await h.rows())[0].attribution_status,'unattributed');
  const ctx={statements:[]};stageCheckoutAttribution(h.env,ctx,{session:{id:'cs_one',mode:'subscription',status:'complete',customer:'cus_one',subscription:'sub_one'},uid:'owner'});
  await h.db.batch(ctx.statements);assert.equal((await h.rows())[0].attribution_status,'consented_checkout');
  await h.payment({id:'ch_renewal',session:null,sub:'sub_one',amount:1700});await h.link({chargeId:'ch_renewal'});
  assert.equal((await h.rows()).filter(r=>r.attribution_status==='consented_checkout').length,2);
});
test('checkout arriving before the subscription payment also links renewals',async t=>{
  const h=setup(t);await h.context();const ctx={statements:[]};
  stageCheckoutAttribution(h.env,ctx,{session:{id:'cs_one',mode:'subscription',status:'complete',customer:'cus_one',subscription:'sub_one'},uid:'owner'});await h.db.batch(ctx.statements);
  await h.payment({session:null,sub:'sub_one'});await h.link();assert.equal((await h.rows())[0].attribution_status,'consented_checkout');
});
test('same customer is insufficient; foreign environment, wrong session, and expiry remain unattributed',async t=>{
  const h=setup(t);await h.context();
  for(const options of [{id:'ch_wrong_session',session:'cs_other'},{id:'ch_wrong_customer',customer:'cus_other'},{id:'ch_dev',environment:'dev'},{id:'ch_other_sub',session:null,sub:'sub_other'}])await h.payment(options);
  await h.link();assert.ok((await h.rows()).every(r=>r.attribution_status==='unattributed'));
  await h.payment();await h.db.prepare('UPDATE checkout_attributions SET expires_at=?').bind(h.now-1).run();await h.link();
  assert.ok((await h.rows()).every(r=>r.attribution_status==='unattributed'));
});
test('withdrawal erases marketing links, preserves money, and regrant cannot resurrect context',async t=>{
  const h=setup(t);await h.context();await h.payment();await h.link();
  await revokeCheckoutAttribution(h.env,{userId:42});await h.link();
  const [row]=await h.rows();assert.equal(row.net_collected,3900);assert.equal(row.attribution_status,'unattributed');assert.equal(row.first_touch_json,null);
  assert.equal(await h.db.prepare('SELECT COUNT(*) AS n FROM stripe_payment_attributions').first('n'),0);
});
test('report eligibility checks persisted withdrawal even before cleanup succeeds',async t=>{
  const h=setup(t);await h.context();await h.payment();await h.link();
  await h.db.prepare("UPDATE cookie_consents SET consent_json='{}' WHERE user_id=42").run();
  assert.equal((await h.rows())[0].attribution_status,'unattributed');assert.equal((await h.rows())[0].first_touch_json,null);
});
test('anonymous rejection vetoes linking and duplicate subscription contexts are not guessed',async t=>{
  const h=setup(t);await h.context({sub:'sub_one'});await h.payment({session:null,sub:'sub_one'});
  await h.db.prepare("INSERT INTO cookie_consents(client_id,consent_json) VALUES('7bbba230-b755-4d31-b475-e20cf6d00ed9','{}')").run();await h.link();assert.equal((await h.rows())[0].attribution_status,'unattributed');
  await h.db.prepare('DELETE FROM cookie_consents WHERE client_id IS NOT NULL').run();
  await h.context({id:'cs_duplicate',sub:'sub_one'});await h.link({checkoutId:'cs_one'});assert.equal((await h.rows())[0].attribution_status,'unattributed');
});
test('wrong account or customer cannot attach a subscription to a checkout',async t=>{
  const h=setup(t);await h.context();
  for(const [uid,customer] of [['other','cus_one'],['owner','cus_other']]){
    const ctx={statements:[]};stageCheckoutAttribution(h.env,ctx,{session:{id:'cs_one',mode:'subscription',status:'complete',customer,subscription:'sub_one'},uid});await h.db.batch(ctx.statements);
  }
  assert.equal(await h.db.prepare('SELECT stripe_subscription_id FROM checkout_attributions').first('stripe_subscription_id'),null);
});
