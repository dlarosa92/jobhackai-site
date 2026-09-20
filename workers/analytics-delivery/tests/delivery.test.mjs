import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sqliteD1} from '../../../app/functions/_lib/__tests__/sqlite-d1-helper.mjs';
import {deliver,enqueue,retain} from '../src/index.ts';
import {beginDeletionAdmission,assertDeletionQuiescent,admitAccountOperation,settleAccountOperation} from '../../../app/functions/_lib/account-deletion-admission.js';
const NOW=1789888000000;
function setup(t){
  const db=sqliteD1();t.after(()=>db.close());
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,auth_id TEXT UNIQUE NOT NULL); INSERT INTO users VALUES(1,\'owner\'); CREATE TABLE deleted_auth_ids(auth_id TEXT PRIMARY KEY); CREATE TABLE cookie_consents(user_id INTEGER,client_id TEXT,consent_json TEXT);');
  for(const file of ['024_collected_payments.sql','025_checkout_attribution.sql','026_payment_campaign_links.sql','027_analytics_delivery.sql','028_account_deletion_recovery.sql'])
    db.exec(readFileSync(new URL('../../../app/db/migrations/'+file,import.meta.url),'utf8'));
  const env={DB:db,ENVIRONMENT:'qa',DELIVERY_ENABLED:'true',GA4_MEASUREMENT_ID:'G-VH888WWY3M',GA4_API_SECRET:'test-only',DEBUG_EVENTS:'true'};
  db.exec(`INSERT INTO cookie_consents VALUES(1,'browser','{"version":1,"analytics":true}');
    INSERT INTO stripe_collected_payments(charge_id,payment_intent_id,customer_id,environment,livemode,currency,amount_captured,charge_created_at,first_event_id,last_event_id)
      VALUES('ch_test','pi_test','cus_test','qa',0,'usd',3900,${NOW/1000-60},'evt_test','evt_test');
    INSERT INTO checkout_attributions(checkout_session_id,user_id,client_id,stripe_customer_id,environment,ga_client_id,ga_session_id,first_touch_json,last_touch_json,captured_at,expires_at)
      VALUES('cs_test',1,'browser','cus_test','qa','123.456','${NOW/1000-600}','{"at":${NOW-600000},"source":"linkedin","medium":"organic_social","campaign":"voice_beta","asset":"post_01"}',NULL,${NOW-100000},${NOW+86400000});
    INSERT INTO stripe_payment_attributions VALUES('ch_test','cs_test',${NOW});
    INSERT INTO stripe_payment_analytics_values VALUES('ch_test',3900,3900,0,'usd','jobhackai_one_time');`);
  const calls=[];
  const request=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return url.includes('/debug/')?Response.json({validationMessages:[]}):new Response(null,{status:204});};
  const run=(extra={})=>deliver(env,{now:()=>NOW,request,...extra});
  const rows=()=>db.prepare('SELECT event_name,state,last_reason,attempts FROM analytics_delivery ORDER BY event_name').all().then(r=>r.results);
  const refund=(amount=100,tax=0)=>db.exec(`UPDATE stripe_payment_analytics_values SET value_minor=${3900-tax},tax_minor=${tax}; INSERT INTO stripe_payment_refunds VALUES('re_test','ch_test','usd',${amount},'succeeded',${NOW/1000-30},'evt_refund',datetime('now'));`);
  return {db,env,calls,request,run,rows,refund};
}
test('purchase and partial refund deliver once across duplicate and concurrent schedules',async t=>{
  const f=setup(t); f.refund();
  await Promise.all([f.run(),f.run()]); await f.run({now:()=>NOW+5*60000});
  const actual=f.calls.filter(c=>!c.url.includes('/debug/'));
  assert.equal(actual.length,2);
  assert.deepEqual(actual.map(c=>[c.body.events[0].name,c.body.events[0].params.value]),[['purchase',39],['refund',1]]);
  assert(actual.every(c=>c.body.events[0].params.transaction_id==='ch_test'));
  assert.equal(actual[0].body.timestamp_micros,(NOW/1000-60)*1000000);
  assert.equal(actual[0].body.events[0].params.jha_first_campaign,'voice_beta');
  assert.equal(actual[0].body.events[0].params.session_id,NOW/1000-600);
  assert.equal(actual[1].body.events[0].params.items,undefined);
  assert.deepEqual((await f.rows()).map(r=>r.state),['accepted_unverified','accepted_unverified']);
  assert.equal(await f.db.prepare('SELECT verified_at FROM analytics_delivery LIMIT 1').first('verified_at'),null);
});
test('current rejected, malformed, or absent consent and browser veto send nothing',async t=>{
  for(const consent of ['{"version":1,"analytics":false}','{"version":1,"analytics":"true"}','broken','null']){
    const f=setup(t); await f.db.prepare('UPDATE cookie_consents SET consent_json=?').bind(consent).run(); await f.run(); assert.equal(f.calls.length,0);
  }
  const f=setup(t);f.db.exec(`INSERT INTO cookie_consents VALUES(NULL,'browser','{"version":1,"analytics":false}')`);await f.run();assert.equal(f.calls.length,0);
});
test('withdrawal during validation erases the queue and stops collection without deleting money',async t=>{
  const f=setup(t);await f.run({request:async(url,init)=>{
    assert(url.includes('/debug/')); f.db.exec("DELETE FROM checkout_attributions WHERE checkout_session_id='cs_test'");return f.request(url,init);
  }});
  assert.equal(f.calls.length,1);assert.equal((await f.rows()).length,0);
  assert.equal(await f.db.prepare('SELECT amount_captured FROM stripe_collected_payments').first('amount_captured'),3900);
});
test('consent changed without cascade during validation is still checked again',async t=>{
  const f=setup(t);await f.run({request:async(url,init)=>{
    assert(url.includes('/debug/'));f.db.exec(`UPDATE cookie_consents SET consent_json='{"version":1,"analytics":false}'`);return f.request(url,init);
  }});assert.equal(f.calls.length,1);assert.equal((await f.rows())[0].state,'ineligible');
});
test('collection timeout and expired sending lease remain uncertain and are never blindly replayed',async t=>{
  const f=setup(t);let sends=0;
  await f.run({request:async(url,init)=>{if(!url.includes('/debug/')){sends++;throw new Error('network timeout');}return f.request(url,init);}});
  await f.run();assert.equal(sends,1);assert.equal((await f.rows())[0].state,'uncertain');
  f.db.exec(`UPDATE analytics_delivery SET state='sending',lease_until=${NOW-1}`);await f.run();
  assert.equal((await f.rows())[0].last_reason,'collection_lease_expired');assert.equal(f.calls.length,1);
});
test('validation failure retries safely but never collects an invalid event',async t=>{
  const f=setup(t);await f.run({request:async()=>Response.json({validationMessages:[{validationCode:'VALUE_INVALID'}]})});
  assert.equal((await f.rows())[0].state,'pending');assert.equal(f.calls.length,0);
  await f.run({now:()=>NOW+5*60000});assert.equal((await f.rows())[0].state,'accepted_unverified');
});
test('validation diagnostics are size-bounded',async t=>{
  const f=setup(t);await f.run({request:async()=>new Response('x'.repeat(65537))});
  assert.equal((await f.rows())[0].last_reason,'validation_not_confirmed');
});
test('QA never sends live payments, foreign contexts, or production destinations',async t=>{
  for(const sql of ["UPDATE stripe_collected_payments SET livemode=1","UPDATE stripe_collected_payments SET environment='dev'","UPDATE checkout_attributions SET environment='dev'"]){
    const f=setup(t);f.db.exec(sql);await f.run();assert.equal(f.calls.length,0);
  }
  const f=setup(t);f.env.GA4_MEASUREMENT_ID='G-SQYSWPFM5X';await assert.rejects(f.run(),/destination_not_ready/);assert.equal(f.calls.length,0);
  f.env.ENVIRONMENT='prod';await assert.rejects(f.run(),/environment_not_supported/);
});
test('missing actual browser ID or financial breakdown cannot invent an Analytics purchase',async t=>{
  for(const sql of ['UPDATE checkout_attributions SET ga_client_id=NULL','DELETE FROM stripe_payment_analytics_values']){
    const f=setup(t);f.db.exec(sql);await f.run();assert.equal(f.calls.length,0);assert.equal((await f.rows())[0].state,'ineligible');
  }
});
test('tax is excluded from purchase value and partial taxed refunds are held for allocation',async t=>{
  const f=setup(t);f.refund(100,300);await f.run();
  assert.equal(f.calls.length,2);const p=f.calls[1].body.events[0].params;
  assert.equal(p.value,36);assert.equal(p.tax,3);assert.equal(p.items[0].price,36);
  assert.equal((await f.rows()).find(r=>r.event_name==='refund').last_reason,'partial_refund_tax_allocation_unknown');
});
test('full taxed refund uses the exact original value and tax',async t=>{
  const f=setup(t);f.refund(3900,300);await f.run();
  const refund=f.calls.find(c=>!c.url.includes('/debug/')&&c.body.events[0].name==='refund');
  assert.equal(refund.body.events[0].params.value,36);assert.equal(refund.body.events[0].params.tax,3);
});
test('failed refunds never send and a status change during validation stops delivery',async t=>{
  const f=setup(t);await f.run();f.refund();
  await f.run({request:async(url,init)=>{f.db.exec("UPDATE stripe_payment_refunds SET status='failed'");return f.request(url,init);}});
  assert.equal(f.calls.filter(c=>!c.url.includes('/debug/')).length,1);
  assert.equal((await f.rows()).find(r=>r.event_name==='refund').state,'ineligible');
});
test('old events are not relabeled as new and renewal does not reuse an old session',async t=>{
  const f=setup(t);f.db.exec(`UPDATE stripe_collected_payments SET charge_created_at=${NOW/1000-73*3600}`);await f.run();assert.equal(f.calls.length,0);
  const fresh=setup(t);fresh.db.exec(`UPDATE checkout_attributions SET ga_session_id='${NOW/1000-2*86400}'`);await fresh.run();
  assert.equal(fresh.calls[1].body.events[0].params.session_id,undefined);
});
test('expired contexts erase marketing joins and outbox but retain money and refunds',async t=>{
  const f=setup(t);f.refund();await enqueue(f.db,'qa',NOW);f.db.exec(`UPDATE checkout_attributions SET expires_at=${NOW}`);
  await retain(f.db,NOW);
  for(const table of ['checkout_attributions','stripe_payment_attributions','analytics_delivery'])assert.equal(await f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first('n'),0);
  assert.equal(await f.db.prepare('SELECT net_collected FROM stripe_collected_payment_totals').first('net_collected'),3800);
});
test('old campaign touch expires independently of the checkout context',async t=>{
  const f=setup(t);await f.db.prepare('UPDATE checkout_attributions SET first_touch_json=?').bind(JSON.stringify({at:NOW-91*86400000,campaign:'old'})).run();
  f.env.DELIVERY_ENABLED='false';await f.run();assert.equal(f.calls.length,0);
  assert.equal(await f.db.prepare('SELECT first_touch_json FROM checkout_attributions').first('first_touch_json'),null);
});
test('a delivered refund that Stripe later reverses becomes a visible reconciliation case',async t=>{
  const f=setup(t);f.refund();await f.run();f.db.exec("UPDATE stripe_payment_refunds SET status='failed'");await f.run();
  assert.equal((await f.rows()).find(r=>r.event_name==='refund').last_reason,'refund_reversed_after_delivery');
  assert.equal(f.calls.filter(c=>!c.url.includes('/debug/')).length,2);
  assert.equal(await f.db.prepare('SELECT net_collected FROM stripe_collected_payment_totals').first('net_collected'),3900);
});
test('collection 5xx is uncertain, 4xx is rejected, and neither is retried',async t=>{
  for(const [status,state] of [[500,'uncertain'],[408,'uncertain'],[429,'uncertain'],[403,'rejected']]){
    const f=setup(t);let actual=0;
    await f.run({request:async(url,init)=>{if(url.includes('/debug/'))return f.request(url,init);actual++;return new Response(null,{status});}});
    await f.run({now:()=>NOW+300000});assert.equal(actual,1);assert.equal((await f.rows())[0].state,state);
  }
});
test('crashed validation can retry safely; events aging beyond 72 hours expire',async t=>{
  const f=setup(t);await enqueue(f.db,'qa',NOW);
  f.db.exec(`UPDATE analytics_delivery SET state='validating',lease_until=${NOW-1}`);
  await f.run();assert.equal((await f.rows())[0].state,'accepted_unverified');
  const aged=setup(t);await enqueue(aged.db,'qa',NOW);await aged.run({now:()=>NOW+73*3600000});
  assert.equal(aged.calls.length,0);
});

test('a later complete capture requeues only a previously undelivered missing breakdown',async t=>{
  const f=setup(t);f.db.exec("UPDATE stripe_collected_payments SET amount_captured=1950; DELETE FROM stripe_payment_analytics_values");
  await f.run();assert.equal((await f.rows())[0].last_reason,'financial_breakdown_missing');assert.equal(f.calls.length,0);
  f.db.exec("UPDATE stripe_collected_payments SET amount_captured=3900; INSERT INTO stripe_payment_analytics_values VALUES('ch_test',3900,3900,0,'usd','jobhackai_one_time')");
  await f.run();await f.run();
  assert.equal(f.calls.filter(c=>!c.url.includes('/debug/')).length,1);
  assert.equal(f.calls[1].body.events[0].params.value,39);
  assert.equal((await f.rows())[0].state,'accepted_unverified');
});

test('deletion intent or legacy tombstone suppresses both new and previously queued events without erasing money',async t=>{
  for(const alreadyQueued of [false,true]) {
    for(const marker of ['intent','tombstone']) {
      const f=setup(t);f.refund();
      if(alreadyQueued)await enqueue(f.db,'qa',NOW);
      if(marker==='intent')await beginDeletionAdmission(f.env,{origin:'user_request',uid:'owner'});
      else f.db.exec("INSERT INTO deleted_auth_ids VALUES('owner')");
      await f.run();assert.equal(f.calls.length,0);
      assert.equal(await f.db.prepare('SELECT net_collected FROM stripe_collected_payment_totals').first('net_collected'),3800);
      assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM account_operation_claims').first('n'),0);
    }
  }
});

test('deletion inserted between eligible read and atomic admission sends no debug or collection request',async t=>{
  const f=setup(t),prepare=f.db.prepare;let injected=false;
  f.db.prepare=sql=>{
    const stmt=prepare(sql);
    if(sql.startsWith('INSERT INTO account_operation_claims')) {
      const run=stmt.run;
      stmt.run=async function(){
        if(!injected){injected=true;await beginDeletionAdmission(f.env,{origin:'user_request',uid:'owner'});}
        return run.call(this);
      };
    }
    return stmt;
  };
  await f.run();assert.ok(injected);assert.equal(f.calls.length,0);
  assert.equal((await f.rows())[0].last_reason,'account_deletion_pending');
});

test('a changed owner after admission prevents disclosure under the wrong UID',async t=>{
  const f=setup(t),prepare=f.db.prepare;let inserted=false;
  f.db.prepare=sql=>{
    const stmt=prepare(sql);
    if(sql.startsWith('INSERT INTO account_operation_claims')) {
      const run=stmt.run;
      stmt.run=async function(){
        const result=await run.call(this);
        if(!inserted){inserted=true;f.db.exec("UPDATE users SET auth_id='replacement'");}
        return result;
      };
    }
    return stmt;
  };
  await f.run();assert.equal(f.calls.length,0);
  assert.equal((await f.rows())[0].last_reason,'context_changed_before_validation');
  assert.equal(await f.db.prepare('SELECT state FROM account_operation_claims').first('state'),'finished');
});

test('deletion requested during validation waits for the request and prevents subsequent collection',async t=>{
  const f=setup(t);
  await f.run({request:async(url,init)=>{
    assert.match(url,/\/debug\//);
    await beginDeletionAdmission(f.env,{origin:'user_request',uid:'owner'});
    await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
    return f.request(url,init);
  }});
  assert.equal(f.calls.length,1);assert.equal((await f.rows())[0].last_reason,'context_changed_during_validation');
  await assertDeletionQuiescent(f.env,'owner');
});

test('an earlier collection holds deletion through its provider response and final outbox write',async t=>{
  const f=setup(t);let resolve,entered;
  const release=new Promise(r=>{resolve=r;}),started=new Promise(r=>{entered=r;});
  const running=f.run({request:async(url,init)=>{
    if(!url.includes('/debug/')) {entered();await release;}
    return f.request(url,init);
  }});
  await started;await beginDeletionAdmission(f.env,{origin:'user_request',uid:'owner'});
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
  assert.equal((await f.rows())[0].state,'sending');
  resolve();await running;
  assert.equal((await f.rows())[0].state,'accepted_unverified');
  await assertDeletionQuiescent(f.env,'owner');
  await f.run();assert.equal(f.calls.length,2);
});

test('ambiguous collection keeps a traceable unresolved claim and cannot be retried by resetting its outbox lease',async t=>{
  const f=setup(t);
  await f.run({request:async(url,init)=>{
    if(url.includes('/debug/'))return f.request(url,init);
    throw Error('fixture collection timeout');
  }});
  const claim=await f.db.prepare('SELECT * FROM account_operation_claims').first();
  assert.equal(claim.state,'uncertain');assert.equal(claim.analytics_event_key,'purchase:ch_test');
  f.db.exec("UPDATE analytics_delivery SET state='pending',next_attempt_at=0,lease_until=NULL; UPDATE account_operation_claims SET created_at='2000-01-01';");
  await f.run();assert.equal(f.calls.length,1);
  assert.equal((await f.rows())[0].last_reason,'analytics_delivery_unresolved');
  await beginDeletionAdmission(f.env,{origin:'user_request',uid:'owner'});
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
});

test('crashed admission and failed settlement remain active instead of being silently expired',async t=>{
  const f=setup(t);
  await enqueue(f.db,'qa',NOW);
  await admitAccountOperation(f.env,'owner','account',{analyticsEventKey:'purchase:ch_test'});
  f.db.exec(`UPDATE analytics_delivery SET state='validating',lease_until=${NOW-1}`);
  await f.run();assert.equal(f.calls.length,0);
  assert.equal((await f.rows())[0].last_reason,'analytics_delivery_unresolved');
  const failed=setup(t);
  failed.db.exec("CREATE TRIGGER reject_settlement BEFORE UPDATE ON account_operation_claims BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(failed.run(),/fixture failure/);
  assert.equal(await failed.db.prepare('SELECT state FROM account_operation_claims').first('state'),'active');
  await beginDeletionAdmission(failed.env,{origin:'user_request',uid:'owner'});
  await assert.rejects(assertDeletionQuiescent(failed.env,'owner'),/operations_pending/);
});

test('validation failures finish their claim for safe retry; missing deletion schema never reaches Google',async t=>{
  const f=setup(t);
  await f.run({request:async()=>{throw Error('fixture validation timeout');}});
  assert.equal(await f.db.prepare('SELECT state FROM account_operation_claims').first('state'),'finished');
  await f.run({now:()=>NOW+300000});assert.equal((await f.rows())[0].state,'accepted_unverified');
  const missing=setup(t);missing.db.exec('DROP TABLE account_deletion_admissions');
  await assert.rejects(missing.run(),/no such table/);assert.equal(missing.calls.length,0);
});

test('maintenance postpones Analytics without dropping or collecting the event, then allows normal delivery',async t=>{
  const f=setup(t),claim=await admitAccountOperation(f.env,'owner','maintenance');
  await f.run();assert.equal(f.calls.length,0);
  assert.equal((await f.rows())[0].state,'pending');assert.equal((await f.rows())[0].last_reason,'account_operation_busy');
  await settleAccountOperation(f.env,claim,'finished');
  await f.run({now:()=>NOW+300000});assert.equal((await f.rows())[0].state,'accepted_unverified');
});
