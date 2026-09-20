import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../../api/stripe-webhook.js';
import { withWebhookAccountScope } from '../account-webhook-scope.js';
import { beginDeletionAdmission, assertDeletionQuiescent } from '../account-deletion-admission.js';
import { prepareDeletionRecovery, advanceDeletionRecovery, finishDeletionRecovery } from '../account-deletion-recovery.js';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { createFakeKV, makeEnv, makeEvent, makeSubscription, makeContext, signStripeEvent, stubStripeFetch } from './billing-test-helper.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(t) {
  const db = sqliteD1(); t.after(() => db.close());
  const sql = name => readFileSync(new URL('../../../db/' + name, import.meta.url), 'utf8');
  db.exec(sql('schema.sql'));
  for (const name of ['002_add_feature_daily_usage','006_linkedin_runs','008_add_cookie_consents','009_role_templates',
    '022_billing_periods_and_audit','024_collected_payments','025_checkout_attribution','026_payment_campaign_links',
    '027_analytics_delivery','028_account_deletion_recovery']) db.exec(sql('migrations/' + name + '.sql'));
  const coverSource = readFileSync(new URL('../../api/cover-letter/generate.js', import.meta.url), 'utf8');
  db.exec(coverSource.match(/`(CREATE TABLE IF NOT EXISTS cover_letter_history[\s\S]+?)`/)[1]);
  db.exec("INSERT INTO users(id,auth_id,email,plan) VALUES(1,'owner','owner@example.test','monthly')");
  const kv = createFakeKV();
  const env = makeEnv({ DB:db, JOBHACKAI_KV:kv, ENVIRONMENT:'qa', STRIPE_SECRET_KEY:'sk_test_fixture', RESEND_API_KEY:'fixture' });
  const fixture = {
    customer: { id:'cus_owner', email:'owner@example.test', metadata:{firebaseUid:'owner'} },
    sub: makeSubscription({ id:'sub_owner', customer:'cus_owner', priceId:'price_weekly_test',
      metadata:{firebaseUid:'owner',environment:'qa'}, rootPeriodStart:1789800000, rootPeriodEnd:1790404800 }),
    session: { id:'cs_owner', customer:'cus_owner', mode:'payment', status:'complete', payment_status:'paid',
      payment_intent:'pi_owner', metadata:{firebaseUid:'owner',environment:'qa',plan:'pack'},
      line_items:{data:[{price:{id:'price_pack_test'}}]} },
    charge: { id:'ch_owner', customer:'cus_owner', payment_intent:'pi_owner', amount_captured:3900,
      currency:'usd',created:1789800000,status:'succeeded',paid:true,livemode:false },
    refunds: [], email: async () => ({ json:{id:'email_fixture'} })
  };
  const stub = stubStripeFetch([
    { match:'/v1/customers/', reply:() => ({json:fixture.customer}) },
    { match:'/v1/subscriptions?', reply:() => ({json:{data:[],has_more:false}}) },
    { match:'/v1/subscriptions/', reply:() => ({json:fixture.sub}) },
    { match:'/v1/checkout/sessions?', reply:() => ({json:{data:[fixture.session],has_more:false}}) },
    { match:'/v1/checkout/sessions/', reply:() => ({json:fixture.session}) },
    { match:'/v1/charges/', reply:() => ({json:fixture.charge}) },
    { match:'/v1/refunds?', reply:() => ({json:{data:fixture.refunds,has_more:false}}) },
    { match:'api.resend.com', reply:() => fixture.email() }
  ]);
  t.after(() => stub.restore());
  function start(type, options = {}) {
    const object = type.startsWith('checkout.') ? fixture.session
      : type.startsWith('customer.subscription.') ? fixture.sub
        : type.startsWith('invoice.') ? { id:'in_owner',customer:'cus_owner',subscription:'sub_owner' }
          : fixture.charge;
    const event = makeEvent(type, object, {livemode:false,...options});
    const {raw,header} = signStripeEvent(env.STRIPE_WEBHOOK_SECRET,event);
    const request = new Request('https://qa.jobhackai.io/api/stripe-webhook', {
      method:'POST',headers:{'stripe-signature':header},body:raw
    });
    const {context,settle,waited} = makeContext(env,request);
    return {event,promise:onRequest(context),settle,waited};
  }
  return {db,env,kv,fixture,stub,start,
    state:() => db.prepare('SELECT state FROM account_operation_claims').first('state'),
    count:table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n'),
    async send(type,options) { const run=start(type,options); const response=await run.promise; await run.settle(); return {response,event:run.event}; },
    async erase() {
      await beginDeletionAdmission(env,{uid:'owner'});
      const job=await prepareDeletionRecovery(env,{uid:'owner'});
      // Identity and billing confirmations are fixture inputs, not live calls.
      await advanceDeletionRecovery(env,job.id,'billing_verified');
      await advanceDeletionRecovery(env,job.id,'identity_removed');
      await finishDeletionRecovery(env,job.id);
    }
  };
}

test('every entitlement/dunning handler skips existing-account writes after deletion intent', async t => {
  const f=setup(t); await beginDeletionAdmission(f.env,{uid:'owner'});
  f.fixture.sub.status='past_due';
  for (const type of ['checkout.session.completed','checkout.session.async_payment_succeeded',
    'customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.payment_failed']) {
    const {response,event}=await f.send(type);
    assert.equal(response.status,200,type);
    assert.equal(await f.db.prepare('SELECT status FROM stripe_event_ledger WHERE event_id=?').bind(event.id).first('status'),'processed');
  }
  assert.equal(await f.count('account_operation_claims'),0);
  assert.deepEqual(await f.db.prepare('SELECT plan,voice_sessions_remaining FROM users WHERE auth_id=?').bind('owner').first(),
    {plan:'monthly',voice_sessions_remaining:0});
  assert.equal(f.stub.calls.filter(call => call.url.includes('api.resend.com')).length,0);
});

test('legacy D1 tombstone also protects an existing row and completes its harmless claim', async t => {
  const f=setup(t); f.db.exec("INSERT INTO deleted_auth_ids(auth_id) VALUES('owner')");
  assert.equal((await f.send('customer.subscription.updated')).response.status,200);
  assert.equal(await f.db.prepare('SELECT plan FROM users').first('plan'),'monthly');
  assert.equal(await f.state(),'finished');
});

test('legacy KV tombstone is respected even when the account row still exists', async t => {
  const f=setup(t); await f.kv.put('deleted:owner','1');
  assert.equal((await f.send('customer.subscription.deleted')).response.status,200);
  assert.equal(await f.db.prepare('SELECT plan FROM users').first('plan'),'monthly');
  assert.equal(await f.state(),'finished');
});

test('an earlier webhook holds deletion through its actual atomic grant and ledger commit', async t => {
  const f=setup(t),entered=deferred(),release=deferred(),batch=f.db.batch.bind(f.db);
  f.env.DB={...f.db,async batch(statements) {entered.resolve();await release.promise;return batch(statements);}};
  const run=f.start('checkout.session.completed'); await entered.promise;
  await beginDeletionAdmission(f.env,{uid:'owner'});
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
  assert.equal(await f.state(),'active'); release.resolve();
  assert.equal((await run.promise).status,200);await run.settle();
  assert.equal(await f.db.prepare('SELECT voice_sessions_remaining FROM users').first('voice_sessions_remaining'),5);
  assert.equal(await f.state(),'finished'); assert.ok(await assertDeletionQuiescent(f.env,'owner'));
  assert.equal(await f.db.prepare('SELECT webhook_event_id FROM account_operation_claims').first('webhook_event_id'),run.event.id);
});

test('post-commit cache work keeps the webhook claim active', async t => {
  const f=setup(t),entered=deferred(),release=deferred(),remove=f.kv.delete;
  f.kv.delete=async key => {if(key==='planByUid:owner'){entered.resolve();await release.promise;}return remove(key);};
  const run=f.start('customer.subscription.updated');await entered.promise;
  assert.equal(await f.db.prepare('SELECT status FROM stripe_event_ledger').first('status'),'processed');
  await beginDeletionAdmission(f.env,{uid:'owner'});
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
  release.resolve();assert.equal((await run.promise).status,200);await run.settle();
  assert.equal(await f.state(),'finished');
});

test('a queued cancellation email holds admission after the HTTP response', async t => {
  const f=setup(t),entered=deferred(),release=deferred();
  f.fixture.email=async()=>{entered.resolve();await release.promise;return {json:{id:'fixture_email'}};};
  const run=f.start('customer.subscription.deleted');
  assert.equal((await run.promise).status,200);await entered.promise;
  await beginDeletionAdmission(f.env,{uid:'owner'});
  assert.equal(await f.state(),'active');
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
  release.resolve();await run.settle();assert.equal(await f.state(),'finished');
});

test('failed critical write preserves durable uncertainty and rolls back the plan and ledger batch', async t => {
  const f=setup(t);
  f.db.exec("CREATE TRIGGER deny_plan BEFORE UPDATE OF plan ON users BEGIN SELECT RAISE(ABORT,'fixture interruption'); END;");
  assert.equal((await f.send('customer.subscription.updated')).response.status,503);
  assert.equal(await f.state(),'uncertain');
  assert.equal(await f.db.prepare('SELECT plan FROM users').first('plan'),'monthly');
  assert.equal(await f.db.prepare('SELECT status FROM stripe_event_ledger').first('status'),'failed');
  await beginDeletionAdmission(f.env,{uid:'owner'});
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
});

test('failed post-commit cache work cannot be hidden by the acknowledged webhook', async t => {
  const f=setup(t),remove=f.kv.delete;
  f.kv.delete=async key=>{if(key==='planByUid:owner')throw Error('fixture cache failure');return remove(key);};
  assert.equal((await f.send('customer.subscription.updated')).response.status,200);
  assert.equal(await f.state(),'uncertain');
});

test('missing admission schema fails closed before any entitlement mutation', async t => {
  const f=setup(t);f.db.exec('DROP TABLE account_deletion_admissions');
  assert.equal((await f.send('customer.subscription.updated')).response.status,503);
  assert.equal(await f.count('account_operation_claims'),0);
  assert.equal(await f.db.prepare('SELECT plan FROM users').first('plan'),'monthly');
});

test('unreadable legacy tombstones fail closed even for an existing account', async t => {
  const f=setup(t);f.db.exec('DROP TABLE deleted_auth_ids');
  assert.equal((await f.send('customer.subscription.updated')).response.status,503);
  assert.equal(await f.state(),'uncertain');
  assert.equal(await f.db.prepare('SELECT plan FROM users').first('plan'),'monthly');
});

test('failure to settle an otherwise successful webhook leaves its durable claim active', async t => {
  const f=setup(t);
  f.db.exec("CREATE TRIGGER deny_settlement BEFORE UPDATE ON account_operation_claims BEGIN SELECT RAISE(ABORT,'fixture settlement failure'); END;");
  await assert.rejects(f.send('customer.subscription.updated'),/fixture settlement failure/);
  assert.equal(await f.state(),'active');
  assert.equal(await f.db.prepare('SELECT status FROM stripe_event_ledger').first('status'),'processed');
  await beginDeletionAdmission(f.env,{uid:'owner'});
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
});

test('owner conflict never receives admission and wrong-mode events never write even a ledger row', async t => {
  const f=setup(t);f.fixture.customer.metadata.firebaseUid='other';
  assert.equal((await f.send('customer.subscription.updated')).response.status,500);
  assert.equal(await f.count('account_operation_claims'),0);
  const before=await f.count('stripe_event_ledger');
  assert.equal((await f.send('customer.subscription.updated',{livemode:true})).response.status,200);
  assert.equal(await f.count('stripe_event_ledger'),before);
});

test('late refunds retain money history after actual recovery erases account and campaign links', async t => {
  const f=setup(t);
  f.db.exec(`INSERT INTO cookie_consents(user_id,client_id,consent_json) VALUES(1,'client','{"version":1,"analytics":true}');
    INSERT INTO checkout_attributions(checkout_session_id,user_id,client_id,stripe_customer_id,environment,captured_at,expires_at)
    VALUES('cs_owner',1,'client','cus_owner','qa',1,9999999999999);`);
  assert.equal((await f.send('charge.succeeded')).response.status,200);
  assert.equal(await f.count('stripe_payment_attributions'),1);
  await f.erase();
  f.fixture.refunds=[{id:'re_owner',charge:'ch_owner',amount:500,currency:'usd',created:1789801000,status:'succeeded'}];
  assert.equal((await f.send('charge.refunded')).response.status,200);
  assert.equal(await f.db.prepare('SELECT net_collected FROM stripe_collected_payment_totals').first('net_collected'),3400);
  for(const table of ['users','checkout_attributions','stripe_payment_attributions','analytics_delivery','account_operation_claims']) {
    assert.equal(await f.count(table),0,table);
  }
  assert.equal((await f.send('checkout.session.completed')).response.status,200);
  assert.equal(await f.count('users'),0);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('financial event staged before erasure cannot restore campaign links when it commits afterward', async t => {
  const f=setup(t),entered=deferred(),release=deferred(),batch=f.db.batch.bind(f.db);
  f.db.exec(`INSERT INTO cookie_consents(user_id,client_id,consent_json) VALUES(1,'client','{"version":1,"analytics":true}');
    INSERT INTO checkout_attributions(checkout_session_id,user_id,client_id,stripe_customer_id,environment,captured_at,expires_at)
    VALUES('cs_owner',1,'client','cus_owner','qa',1,9999999999999);`);
  let paused=false;
  f.env.DB={...f.db,async batch(statements){
    if(!paused && statements.some(statement=>statement.sql.includes('INSERT INTO stripe_collected_payments'))) {
      paused=true;entered.resolve();await release.promise;
    }
    return batch(statements);
  }};
  const run=f.start('charge.succeeded');await entered.promise;await f.erase();release.resolve();
  assert.equal((await run.promise).status,200);await run.settle();
  assert.equal(await f.count('users'),0);assert.equal(await f.count('stripe_collected_payments'),1);
  assert.equal(await f.count('stripe_payment_attributions'),0);assert.equal(await f.count('analytics_delivery'),0);
});

test('scope drains nested background work and refuses late work or a different owner', async t => {
  const f=setup(t),first=deferred(),second=deferred(),waited=[];
  const context={env:f.env,waitUntil:promise=>waited.push(promise)};
  let saved;
  await withWebhookAccountScope(context,async scope=>{
    saved=scope;assert.equal(await scope.admit('owner'),true);
    await assert.rejects(scope.admit('other'),/owner_changed/);
    scope.background(async()=>{await first.promise;scope.background(()=>second.promise);});
    return new Response('ok');
  }, { eventId:'evt_nested_fixture' });
  first.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await f.state(),'active');second.resolve();await Promise.all(waited);
  assert.equal(await f.state(),'finished');let started=false;
  assert.throws(()=>saved.background(()=>{started=true;}),/scope_closed/);assert.equal(started,false);
});

test('rejected queued work preserves uncertainty after a successful response', async t => {
  const f=setup(t),waited=[];
  const context={env:f.env,waitUntil:promise=>waited.push(Promise.resolve(promise).catch(()=>{}))};
  const response=await withWebhookAccountScope(context,async scope=>{
    await scope.admit('owner');scope.background(async()=>{throw Error('fixture background failure');});
    return new Response('ok');
  }, { eventId:'evt_rejected_fixture' });
  assert.equal(response.status,200);await Promise.all(waited);assert.equal(await f.state(),'uncertain');
  await beginDeletionAdmission(f.env,{uid:'owner'});
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/operations_pending/);
});
