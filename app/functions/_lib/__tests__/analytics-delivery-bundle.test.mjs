import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { beginDeletionAdmission, assertDeletionQuiescent } from '../account-deletion-admission.js';
const bundle = process.env.JOBHACKAI_ANALYTICS_BUNDLE;
assert.ok(bundle, 'Build the Analytics Worker and set JOBHACKAI_ANALYTICS_BUNDLE');
const worker = (await import(pathToFileURL(bundle))).default;

test('compiled scheduled Analytics Worker holds deletion through collection and never treats acceptance as verified revenue', async t => {
  const db = sqliteD1(); t.after(() => db.close());
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,auth_id TEXT UNIQUE); INSERT INTO users VALUES(1,'owner'); CREATE TABLE deleted_auth_ids(auth_id TEXT PRIMARY KEY); CREATE TABLE cookie_consents(user_id INTEGER,client_id TEXT,consent_json TEXT);");
  for (const name of ['024_collected_payments','025_checkout_attribution','026_payment_campaign_links','027_analytics_delivery','028_account_deletion_recovery']) {
    db.exec(readFileSync(new URL('../../../db/migrations/' + name + '.sql', import.meta.url), 'utf8'));
  }
  const now = Date.now(), seconds = Math.floor(now / 1000);
  db.exec(`INSERT INTO cookie_consents VALUES(1,'fixture-browser','{"version":1,"analytics":true}');
    INSERT INTO stripe_collected_payments(charge_id,payment_intent_id,customer_id,environment,livemode,currency,amount_captured,charge_created_at,first_event_id,last_event_id)
      VALUES('ch_fixture','pi_fixture','cus_fixture','qa',0,'usd',3400,${seconds-60},'evt_fixture','evt_fixture');
    INSERT INTO checkout_attributions(checkout_session_id,user_id,client_id,stripe_customer_id,environment,ga_client_id,ga_session_id,captured_at,expires_at)
      VALUES('cs_fixture',1,'fixture-browser','cus_fixture','qa','123.456','${seconds-600}',${now-100000},${now+86400000});
    INSERT INTO stripe_payment_attributions VALUES('ch_fixture','cs_fixture',${now});
    INSERT INTO stripe_payment_analytics_values VALUES('ch_fixture',3400,3400,0,'usd','jobhackai_subscription');`);
  const env = { DB: db, ENVIRONMENT: 'qa', DELIVERY_ENABLED: 'true', GA4_MEASUREMENT_ID: 'G-VH888WWY3M', GA4_API_SECRET: 'fixture-only', DEBUG_EVENTS: 'true' };
  const originalFetch = globalThis.fetch, calls = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, init) => {
    const address = new URL(url); assert.equal(address.origin, 'https://www.google-analytics.com');
    const payload = JSON.parse(init.body); calls.push(address.pathname);
    assert.equal(payload.events[0].params.value, 34);
    assert.equal(await db.prepare('SELECT state FROM account_operation_claims').first('state'), 'active');
    if (address.pathname === '/debug/mp/collect') return Response.json({ validationMessages: [] });
    assert.equal(address.pathname, '/mp/collect');
    await beginDeletionAdmission(env, {origin:'user_request', uid: 'owner' });
    await assert.rejects(assertDeletionQuiescent(env, 'owner'), /operations_pending/);
    return new Response(null, { status: 204 });
  };
  const run = async () => { const pending = []; worker.scheduled({}, env, { waitUntil(p) { pending.push(p); } }); await Promise.all(pending); };
  await run(); await run();
  assert.deepEqual(calls, ['/debug/mp/collect', '/mp/collect']);
  await assertDeletionQuiescent(env, 'owner');
  assert.deepEqual(await db.prepare('SELECT state,verified_at FROM analytics_delivery').first(), { state: 'accepted_unverified', verified_at: null });
  assert.equal(await db.prepare('SELECT analytics_event_key FROM account_operation_claims').first('analytics_event_key'), 'purchase:ch_fixture');
});
