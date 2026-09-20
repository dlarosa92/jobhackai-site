import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { resolvePortalCustomer, PortalOwnershipError } from '../billing-portal-owner.js';
import { stripe } from '../billing-utils.js';
import { assertStripeKeyMatchesEnvironment } from '../stripe-environment.js';

const realFetch = globalThis.fetch;
const route = readFileSync(new URL('../../api/billing-portal.js', import.meta.url), 'utf8');
const customer = (id = 'cus_owner', uid = 'owner') => ({ id, livemode: false, metadata: uid ? { firebaseUid: uid } : {} });
const subscription = (id = 'sub_owner', environment = 'qa') => ({ id, customer: 'cus_owner', status: 'active', metadata: { firebaseUid: 'owner', environment } });
function setup(t, { mapped = 'cus_owner', customers = [customer()], subscriptions = [subscription()], override } = {}) {
  const db = sqliteD1(); t.after(() => db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, auth_id TEXT, email TEXT, stripe_customer_id TEXT, stripe_subscription_id TEXT);
    INSERT INTO users VALUES(1,'owner','owner@example.test',NULL,'sub_owner'),(2,'other','owner@example.test','cus_other','sub_other');`);
  const calls = [], logs = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.stripe.com');
    calls.push({ path: u.pathname + u.search, method: init.method || 'GET', body: init.body });
    const custom = await override?.(u, init);
    if (custom) return custom;
    if (u.pathname === '/v1/customers') return Response.json({ data: customers, has_more: false });
    if (u.pathname.startsWith('/v1/customers/')) {
      const row = customers.find(c => u.pathname === '/v1/customers/' + c.id);
      return row ? Response.json(row) : Response.json({ error: { message: 'No such customer' } }, { status: 404 });
    }
    if (u.pathname === '/v1/subscriptions') return Response.json({ data: subscriptions, has_more: false });
    if (u.pathname === '/v1/billing_portal/sessions') return Response.json({ url: 'https://billing.stripe.com/fixture?secret=never-log-this' });
    throw Error('Unexpected Stripe request: ' + u.pathname);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const env = { JOBHACKAI_DB: db, STRIPE_SECRET_KEY: 'sk_test_fixture', ENVIRONMENT: 'qa',
    FRONTEND_URL: 'https://qa.jobhackai.io', STRIPE_PORTAL_CONFIGURATION_ID_DEV: 'bpc_fixture',
    JOBHACKAI_KV: { get: async () => { throw Error('KV must not authorize portal access'); }, put: async () => { throw Error('No identity repair in portal'); } } };
  const ctx = { Request, Response, URLSearchParams, stripe, resolvePortalCustomer, PortalOwnershipError, assertStripeKeyMatchesEnvironment,
    console: Object.fromEntries(['log','error','warn'].map(k => [k, (...args) => logs.push(args)])),
    getBearer: r => r.headers.get('Authorization')?.replace(/^Bearer /, ''),
    verifyFirebaseIdToken: async token => { if (token !== 'valid') throw Error('private token detail'); return { uid: 'owner', payload: { email: 'owner@example.test' } }; } };
  vm.createContext(ctx);
  vm.runInContext(route.replace(/^import .*;\n/gm, '').replace('export async function onRequest','async function onRequest') + '\nglobalThis.handler=onRequest;', ctx);
  return { db, env, calls, logs, ctx, async run(token = 'valid') {
    await db.prepare('UPDATE users SET stripe_customer_id=? WHERE id=1').bind(mapped).run();
    return ctx.handler({ env, request: new Request('https://qa.jobhackai.io/api/billing-portal?customer=cus_other', {
      method: 'POST', headers: token ? { Authorization: 'Bearer ' + token, Origin: 'https://qa.jobhackai.io' } : {},
      body: JSON.stringify({ customer: 'cus_other', uid: 'other' }) }) });
  } };
}
const portalCalls = h => h.calls.filter(c => c.path === '/v1/billing_portal/sessions');

test('actual route uses verified D1 owner, ignores KV and client-selected customer, and never logs portal URL', async t => {
  const h = setup(t); const response = await h.run();
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(portalCalls(h).length, 1); assert.equal(portalCalls(h)[0].body.get('customer'), 'cus_owner');
  assert.equal(portalCalls(h)[0].body.get('configuration'), 'bpc_fixture');
  assert.equal(portalCalls(h)[0].body.get('return_url'), 'https://qa.jobhackai.io/dashboard');
  assert.ok(!JSON.stringify(h.logs).includes('never-log-this'));
  assert.equal((await h.db.prepare('SELECT stripe_customer_id FROM users WHERE id=2').first()).stripe_customer_id, 'cus_other');
});
for (const [name, uid] of [['foreign owner','other'],['unstamped customer',null]]) {
  test(name + ' in D1 cannot open a portal', async t => {
    const h = setup(t, { customers: [customer('cus_owner', uid)] });
    assert.equal((await h.run()).status, 409); assert.equal(portalCalls(h).length, 0);
  });
  test(name + ' found by email is never adopted', async t => {
    const h = setup(t, { mapped: null, customers: [customer('cus_owner', uid)] });
    assert.equal((await h.run()).status, 404); assert.equal(portalCalls(h).length, 0);
    assert.equal((await h.db.prepare('SELECT stripe_customer_id FROM users WHERE id=1').first()).stripe_customer_id, null);
  });
}
test('deleted D1 customer can resolve one freshly proven owned email match without rewriting identity', async t => {
  const h = setup(t, { mapped:'cus_deleted' });
  assert.equal((await h.run()).status, 200);
  assert.equal((await h.db.prepare('SELECT stripe_customer_id FROM users WHERE id=1').first()).stripe_customer_id, 'cus_deleted');
});
test('duplicate owned email matches are ambiguous, not newest-wins', async t => {
  const h = setup(t, { mapped:null, customers:[customer(), customer('cus_second')] });
  assert.equal((await h.run()).status, 409); assert.equal(portalCalls(h).length, 0);
});
test('email fallback rechecks customer ownership before granting access', async t => {
  const h = setup(t, { mapped:null, override:u=>u.pathname==='/v1/customers/cus_owner' ? Response.json(customer('cus_owner','other')) : null });
  assert.equal((await h.run()).status, 409); assert.equal(portalCalls(h).length, 0);
});
test('D1 cross-user customer and subscription conflicts prevent portal creation', async t => {
  for (const column of ['stripe_customer_id','stripe_subscription_id']) {
    const h = setup(t); h.db.exec(`UPDATE users SET ${column}='${column==='stripe_customer_id'?'cus_owner':'sub_owner'}' WHERE id=2`);
    assert.equal((await h.run()).status, 409); assert.equal(portalCalls(h).length, 0);
  }
});
for (const [name, sub] of [
  ['foreign environment',subscription('sub_owner','dev')],
  ['unstamped nonproduction subscription',subscription('sub_owner',undefined)],
  ['foreign subscriber',{...subscription(),metadata:{firebaseUid:'other',environment:'qa'}}],
  ['wrong customer',{...subscription(),customer:'cus_other'}],
  ['unknown status',{...subscription(),status:'unknown'}]
]) test(name + ' prevents full-customer portal access', async t => {
  if (name.startsWith('unstamped')) delete sub.metadata.environment;
  const h = setup(t, { subscriptions:[sub] }); assert.equal((await h.run()).status, 409); assert.equal(portalCalls(h).length, 0);
});
test('foreign active subscription on a later page is not missed', async t => {
  const h = setup(t, { override:u=>u.pathname==='/v1/subscriptions' ? Response.json({data:[u.searchParams.has('starting_after')?subscription('sub_second','dev'):subscription()],has_more:!u.searchParams.has('starting_after')}) : null });
  assert.equal((await h.run()).status,409); assert.equal(portalCalls(h).length,0);
  assert.ok(h.calls.some(c=>c.path.includes('starting_after=sub_owner')));
});
test('later customer page cannot hide an ambiguous second owned account', async t => {
  const h = setup(t, { mapped:null, override:u=>u.pathname==='/v1/customers' ? Response.json({data:[customer(u.searchParams.has('starting_after')?'cus_second':'cus_owner')],has_more:!u.searchParams.has('starting_after')}) : null });
  assert.equal((await h.run()).status,409); assert.equal(portalCalls(h).length,0);
});
for (const path of ['/v1/customers/cus_owner','/v1/subscriptions','/v1/billing_portal/sessions']) {
  test(path+' failure is retryable and leaks no Stripe error',async t=>{
    const h=setup(t,{override:u=>u.pathname===path?Response.json({error:{message:'private provider details'}},{status:503}):null});
    const response=await h.run();assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private provider'));
    if(path!=='/v1/billing_portal/sessions')assert.equal(portalCalls(h).length,0);
  });
}
test('unavailable D1 fails closed before Stripe; missing account cannot open portal',async t=>{
  const h=setup(t);h.env.JOBHACKAI_DB=null;assert.equal((await h.run()).status,503);assert.equal(h.calls.length,0);
  h.env.JOBHACKAI_DB=h.db;h.db.exec('DELETE FROM users WHERE id=1');assert.equal((await h.run()).status,404);assert.equal(h.calls.length,0);
});
test('missing or invalid auth and mismatched key mode cause no Stripe request',async t=>{
  const h=setup(t);for(const token of [null,'invalid'])assert.equal((await h.run(token)).status,401);
  h.env.STRIPE_SECRET_KEY='sk_live_fixture';assert.equal((await h.run()).status,503);assert.equal(h.calls.length,0);
});
test('malformed pagination and repeated cursors do not grant partial authorization',async t=>{
  for(const body of [{data:[],has_more:true},{data:[subscription()],has_more:true},{data:[subscription()]}]){
    const h=setup(t,{override:u=>u.pathname==='/v1/subscriptions'?Response.json(body):null});
    assert.equal((await h.run()).status,503);assert.equal(portalCalls(h).length,0);
  }
});
test('legacy production subscriptions without environment stamps remain usable with proven ownership',async t=>{
  const h=setup(t,{customers:[{...customer(),livemode:true}],subscriptions:[{...subscription(),metadata:{firebaseUid:'owner'}}]});
  h.env.ENVIRONMENT='PROD';h.env.STRIPE_SECRET_KEY='sk_live_fixture';assert.equal((await h.run()).status,200);
});
test('a customer response from the wrong Stripe mode never authorizes a portal',async t=>{
  const h=setup(t,{customers:[{...customer(),livemode:true}]});
  assert.equal((await h.run()).status,409);assert.equal(portalCalls(h).length,0);
});
