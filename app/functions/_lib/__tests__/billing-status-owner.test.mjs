import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { resolveBillingAccount, PortalOwnershipError } from '../billing-portal-owner.js';
import { pickBestSubscription, priceIdToPlan } from '../billing-utils.js';
import { assertStripeKeyMatchesEnvironment } from '../stripe-environment.js';
import { readSubscriptionPeriod, readSubscriptionCancellation } from '../stripe-identity.js';

const source = readFileSync(new URL('../../api/billing-status.js', import.meta.url), 'utf8');
const realFetch = globalThis.fetch;
function setup(t, override) {
  const db = sqliteD1(); t.after(() => db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, auth_id TEXT, email TEXT, stripe_customer_id TEXT, stripe_subscription_id TEXT);
    INSERT INTO users VALUES(1,'owner','owner@example.test','cus_owner','sub_owner'),(2,'other','other@example.test','cus_other','sub_other');`);
  const customer = { id: 'cus_owner', livemode: false, metadata: { firebaseUid: 'owner' }, invoice_settings: { default_payment_method: 'pm_fixture' } };
  const subscription = { id: 'sub_owner', customer: 'cus_owner', status: 'active', metadata: { firebaseUid: 'owner', environment: 'qa' },
    items: { data: [{ price: { id: 'price_monthly' }, current_period_end: 1806302465 }] } };
  const calls = [], logs = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url); assert.equal(u.origin, 'https://api.stripe.com');
    assert.equal(init.method || 'GET', 'GET'); calls.push(u);
    const response = await override?.(u, { customer, subscription }); if (response) return response;
    if (u.pathname === '/v1/customers/cus_owner') return Response.json(customer);
    if (u.pathname === '/v1/customers') return Response.json({ data: [], has_more: false });
    if (u.pathname === '/v1/subscriptions') return Response.json({ data: [subscription], has_more: false });
    throw Error('Unexpected request');
  };
  t.after(() => { globalThis.fetch = realFetch; });
  let kvReads = 0, kvWrites = 0;
  const env = { DB: db, ENVIRONMENT: 'qa', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PRICE_MONTHLY: 'price_monthly', FRONTEND_URL: 'https://qa.jobhackai.io',
    JOBHACKAI_KV: { get: async key => { kvReads++; return key.startsWith('billingStatus:') ? JSON.stringify({ timestamp: Date.now(), data: { ok: true, plan: 'premium', cancelAt: null } }) : 'cus_other'; }, put: async () => { kvWrites++; } } };
  const ctx = { Request, Response, resolveBillingAccount, PortalOwnershipError, pickBestSubscription, priceIdToPlan,
    assertStripeKeyMatchesEnvironment, readSubscriptionPeriod, readSubscriptionCancellation,
    console: Object.fromEntries(['log','error','warn'].map(k => [k, (...args) => logs.push(args)])),
    getBearer: r => r.headers.get('Authorization')?.replace(/^Bearer /, ''),
    verifyFirebaseIdToken: async token => { if (token !== 'valid') throw Error('private token detail'); return { uid: 'owner', payload: { email: 'owner@example.test' } }; } };
  vm.createContext(ctx);
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace('export async function onRequest','async function onRequest') + '\nglobalThis.handler=onRequest;',ctx);
  return { db, env, customer, subscription, calls, logs, kvCounts: () => [kvReads,kvWrites], run: (suffix = '', token = 'valid') => ctx.handler({ env,
    request: new Request('https://qa.jobhackai.io/api/billing-status'+suffix, { headers: token ? { Authorization: 'Bearer '+token } : {} }) }) };
}

test('stale foreign KV identity and cached status cannot override the fresh owned snapshot', async t => {
  const h=setup(t); const response=await h.run(); const body=await response.json();
  assert.equal(response.status,200); assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(body.plan,'monthly'); assert.equal(body.status,'active'); assert.equal(body.currentPeriodEnd,1806302465000);
  assert.equal(body.hasPaymentMethod,true); assert.equal(body.cancelAt,null); assert.equal(body._cached,undefined);
  assert.deepEqual(h.kvCounts(),[0,0]); assert.equal(h.calls.length,2);
});
test('force refresh and default requests both observe fresh cancellation and renewal state', async t => {
  const h=setup(t); await h.run(); h.subscription.cancel_at_period_end=true;
  assert.equal((await (await h.run('?force=1')).json()).cancelAt,1806302465000);
  h.subscription.cancel_at_period_end=false; h.subscription.items.data[0].current_period_end=1808980865;
  const body=await (await h.run()).json(); assert.equal(body.cancelAt,null); assert.equal(body.currentPeriodEnd,1808980865000);
});
for(const status of ['trialing','past_due','unpaid']) test(status+' is reported without downgrading the display to free',async t=>{
  const h=setup(t);h.subscription.status=status;h.subscription.trial_end=status==='trialing'?1806302465:null;
  const body=await (await h.run()).json();assert.equal(body.status,status);assert.equal(body.plan,'monthly');
  assert.equal(body.trialEndsAt,status==='trialing'?1806302465000:null);
});
for(const [label,change] of [
  ['foreign customer metadata',h=>h.customer.metadata.firebaseUid='other'],
  ['cross-user customer mapping',h=>h.db.exec("UPDATE users SET stripe_customer_id='cus_owner' WHERE id=2")],
  ['foreign subscription metadata',h=>h.subscription.metadata.firebaseUid='other'],
  ['foreign active environment',h=>h.subscription.metadata.environment='dev']
]) test(label+' discloses no billing details',async t=>{
  const h=setup(t);change(h);const response=await h.run();assert.equal(response.status,409);
  const body=await response.json();assert.equal(body.ok,false);assert.equal(body.plan,undefined);assert.equal(body.currentPeriodEnd,undefined);
});
test('all pages are validated and a later active subscription is reported',async t=>{
  const h=setup(t,(u,{subscription})=>u.pathname==='/v1/subscriptions'?Response.json({data:[u.searchParams.has('starting_after')?subscription:{...subscription,id:'sub_old',status:'canceled'}],has_more:!u.searchParams.has('starting_after')}):null);
  assert.equal((await (await h.run()).json()).plan,'monthly');assert.equal(h.calls.length,3);
});
test('later-page ownership conflict blocks the entire response',async t=>{
  const h=setup(t,(u,{subscription})=>u.pathname==='/v1/subscriptions'?Response.json({data:[u.searchParams.has('starting_after')?{...subscription,id:'sub_other',metadata:{firebaseUid:'other'}}:subscription],has_more:!u.searchParams.has('starting_after')}):null);
  assert.equal((await h.run()).status,409);
});
test('missing billing account and ended subscriptions report no subscription without writes',async t=>{
  const h=setup(t);h.subscription.status='canceled';assert.equal((await (await h.run()).json()).status,'none');
  h.db.exec('UPDATE users SET stripe_customer_id=NULL WHERE id=1');assert.equal((await (await h.run()).json()).status,'none');
  assert.deepEqual(h.kvCounts(),[0,0]);
});
test('invalid auth, unavailable database and wrong key mode fail before Stripe',async t=>{
  const h=setup(t);for(const token of [null,'invalid'])assert.equal((await h.run('',token)).status,401);
  h.env.STRIPE_SECRET_KEY='sk_live_fixture';assert.equal((await h.run()).status,503);
  h.env.STRIPE_SECRET_KEY='sk_test_fixture';h.env.DB=null;assert.equal((await h.run()).status,503);assert.equal(h.calls.length,0);
});
test('provider failure returns retryable error, never fabricated free plan or private error detail',async t=>{
  const h=setup(t,()=>Response.json({error:{message:'private provider details'}},{status:503}));
  const response=await h.run();assert.equal(response.status,503);const body=await response.json();
  assert.equal(body.plan,undefined);assert.ok(!JSON.stringify(body).includes('private'));assert.ok(!JSON.stringify(h.logs).includes('private provider'));
});
