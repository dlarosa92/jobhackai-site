import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { stripeCheckApi, stripeCheckStatus, validateStripeCheck, readStripeBasis, STRIPE_ACCOUNT } from './src/stripe-check.js';
import { allowed } from './src/access.js';
const now=new Date('2026-11-01T17:00:00Z');
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE board_revision(id INTEGER PRIMARY KEY,revision INTEGER);INSERT INTO board_revision VALUES(1,0);
 CREATE TABLE users(email TEXT,plan TEXT,stripe_customer_id TEXT,stripe_subscription_id TEXT,subscription_status TEXT,current_period_end TEXT,voice_sessions_remaining INTEGER,pack_expires_at TEXT);
 CREATE TABLE stripe_collected_payments(charge_id TEXT,payment_intent_id TEXT,customer_id TEXT,environment TEXT,livemode INTEGER,currency TEXT,charge_created_at INTEGER,amount_captured INTEGER);
 CREATE TABLE stripe_payment_refunds(charge_id TEXT,currency TEXT,status TEXT,refund_created_at INTEGER,amount INTEGER);`);
 sql.exec(readFileSync(new URL('./migrations/010-stripe-checks.sql',import.meta.url),'utf8'));
 sql.exec(`INSERT INTO users VALUES('staff@jobhackai.io','weekly','cus_staff','sub_staff','active','2026-11-05T17:00:00Z',0,NULL),('customer@example.com','weekly','cus_real','sub_real','active','2026-11-05T17:00:00Z',0,NULL);
 INSERT INTO stripe_collected_payments VALUES('ch_staff','pi_staff','cus_staff','prod',1,'usd',unixepoch('2026-10-29T17:00:00Z'),1700),('ch_real','pi_real','cus_real','prod',1,'usd',unixepoch('2026-10-20T17:00:00Z'),1700);
 INSERT INTO stripe_payment_refunds VALUES('ch_real','usd','succeeded',unixepoch('2026-10-21T17:00:00Z'),200);`);
 const db={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async all(){return {results:sql.prepare(query).all(...this.args)};},async first(){return sql.prepare(query).get(...this.args)||null;},async run(){return {meta:{changes:sql.prepare(query).run(...this.args).changes}};}};}};
 const env={DASHBOARD_DB:db,PRODUCTION_DB:db};
 const input={account:STRIPE_ACCOUNT,livemode:true,checkedAt:now.toISOString(),startDate:'2026-09-06',endDate:'2026-10-31',complete:{payments:true,refunds:true,activeSubscriptions:true},sourceUrls:[`https://dashboard.stripe.com/${STRIPE_ACCOUNT}/payments`],charges:[{paymentId:'pi_staff',customerId:'cus_staff',date:'2026-10-29',amount:1700},{paymentId:'pi_real',customerId:'cus_real',date:'2026-10-20',amount:1700}],refunds:[{paymentId:'pi_real',date:'2026-10-21',amount:200}],subscriptions:[{id:'sub_staff',customerId:'cus_staff'},{id:'sub_real',customerId:'cus_real'}]};
 const post=(body=input,time=now)=>stripeCheckApi(new Request('https://dashboard.example/api/stripe-check',{method:'POST',body:JSON.stringify(body)}),env,time);
 return {sql,env,input,post};
}
for(let round=1;round<=3;round++)test(`Stripe verification lifecycle round ${round}: missing, exact match, changed records, fresh recheck, failed source`,async()=>{
 const f=fixture();assert.equal((await stripeCheckStatus(f.env,now)).status,'unavailable');
 assert.equal((await f.post()).status,200);
 let status=await stripeCheckStatus(f.env,now);assert.equal(status.status,'current');assert.equal(status.customers,1);
 assert.equal(f.sql.prepare('SELECT revision FROM board_revision').get().revision,1);
 const original=await readStripeBasis(f.env.PRODUCTION_DB,now);
 assert.equal((await f.post()).status,200);assert.equal(f.sql.prepare('SELECT revision FROM board_revision').get().revision,1);
 f.sql.exec('UPDATE stripe_collected_payments SET amount_captured=1800 WHERE payment_intent_id=\'pi_real\'');
 status=await stripeCheckStatus(f.env,now);assert.equal(status.status,'incomplete');assert.match(status.detail,/changed/);
 const later=new Date(now.getTime()+60000);const revised=structuredClone(f.input);revised.checkedAt=later.toISOString();revised.charges[1].amount=1800;
 assert.equal((await f.post(revised,later)).status,200);assert.equal((await stripeCheckStatus(f.env,later)).status,'current');
 const failedAt=new Date(now.getTime()+120000);await f.post({account:STRIPE_ACCOUNT,livemode:true,status:'unavailable',checkedAt:failedAt.toISOString(),detail:'Reconnect Stripe in Codex.'},failedAt);
 assert.equal((await stripeCheckStatus(f.env,failedAt)).status,'unavailable');
 await f.post(f.input,failedAt);assert.equal((await stripeCheckStatus(f.env,failedAt)).status,'unavailable');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stripe_checks').get().n,3);
 assert.notEqual((await readStripeBasis(f.env.PRODUCTION_DB,now)).fingerprint,original.fingerprint);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stripe_collected_payments').get().n,2);
 f.sql.close();
});
test('reject wrong account, test mode, incomplete pages, duplicate rows, stale and wrong-window observations',()=>{
 const f=fixture();
 for(const changed of [{account:'acct_other'},{livemode:false},{complete:{payments:true,refunds:false,activeSubscriptions:true}},{checkedAt:'2026-10-31T00:00:00Z'},{endDate:'2026-10-30'},{charges:[f.input.charges[0],f.input.charges[0]]},{refunds:[...f.input.refunds,...f.input.refunds]},{sourceUrls:['https://example.com']}]) assert.throws(()=>validateStripeCheck({...f.input,...changed},now));
 f.sql.close();
});
test('mismatches never become green, date rollover expires evidence, and pack access remains explicit',async()=>{
 const f=fixture();const wrong=structuredClone(f.input);wrong.charges[0].amount=1;await f.post(wrong);assert.equal((await stripeCheckStatus(f.env,now)).status,'incomplete');
 assert.equal((await f.post()).status,409);
 assert.equal((await stripeCheckStatus(f.env,new Date('2026-11-02T12:00:00Z'))).status,'stale');f.sql.close();
 const g=fixture();g.sql.exec("INSERT INTO users VALUES('pack@example.com','free','cus_pack',NULL,NULL,NULL,2,'2026-11-15T00:00:00Z')");await g.post();assert.match((await stripeCheckStatus(g.env,now)).detail,/purchase-to-credit/);g.sql.close();
});
test('only reconcile can import checks; read can get health, while financial records and costs stay owner-only',async()=>{
 assert.equal(allowed({role:'machine',capabilities:['read']},'GET','/api/stripe-check'),true);
 assert.equal(allowed({role:'machine',capabilities:['read']},'POST','/api/stripe-check'),false);
 assert.equal(allowed({role:'machine',capabilities:['reconcile']},'POST','/api/stripe-check'),true);
 assert.equal(allowed({role:'machine',capabilities:['read','reconcile']},'GET','/api/overview'),false);
 assert.equal(allowed({role:'machine',capabilities:['read','reconcile']},'POST','/api/costs'),false);
 const f=fixture();await f.post();const response=await stripeCheckApi(new Request('https://dashboard.example/api/stripe-check'),f.env,now);const body=await response.json();assert.deepEqual(Object.keys(body).sort(),['checkedAt','detail','status']);assert.equal(body.customers,undefined);f.sql.close();
});
