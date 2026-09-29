import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../../api/stripe-webhook.js';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { makeEnv, makeEvent, postWebhook, stubStripeFetch } from './billing-test-helper.mjs';

const migration = readFileSync(new URL('../../../db/migrations/024_collected_payments.sql', import.meta.url), 'utf8');
const oldMigration = readFileSync(new URL('../../../db/migrations/022_billing_periods_and_audit.sql', import.meta.url), 'utf8');
let tests = 0;
async function test(name, run) {
  const db = sqliteD1();
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, auth_id TEXT);');
  db.exec(oldMigration);
  db.exec(migration);
  db.exec('CREATE TABLE cookie_consents(user_id INTEGER,client_id TEXT,consent_json TEXT);');
  for (const file of ['025_checkout_attribution.sql','026_payment_campaign_links.sql','027_analytics_delivery.sql']) {
    db.exec(readFileSync(new URL('../../../db/migrations/'+file, import.meta.url),'utf8'));
  }
  const env = makeEnv({ ENVIRONMENT: 'qa', STRIPE_SECRET_KEY: 'sk_test_fixture', DB: db,
    GA4_MEASUREMENT_ID: 'G-FIXTURE', GA4_API_SECRET: 'fixture' });
  const fixture = {
    charge: { id: 'ch_paid', object: 'charge', customer: 'cus_owner', payment_intent: 'pi_paid',
      amount: 3900, amount_captured: 1950, currency: 'usd', created: 1789800000,
      status: 'succeeded', paid: true, captured: true, livemode: false },
    session: { id: 'cs_pack', mode: 'payment', status: 'complete', payment_status: 'paid',
      customer: 'cus_owner', payment_intent: 'pi_paid', metadata: { environment: 'qa' } },
    invoice: { id: 'in_month', customer: 'cus_owner', parent: { subscription_details: { subscription: 'sub_month', metadata: { environment: 'qa' } } } },
    subscription: { id: 'sub_month', customer: 'cus_owner', metadata: { environment: 'qa' } },
    payments: [{ id: 'inpay_one', invoice: 'in_month', status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_paid' } }],
    refunds: [], invoiceMode: false, failRead: false, paginated: false
  };
  const stub = stubStripeFetch([
    { match: '/v1/charges/', reply: () => fixture.failRead ? { status: 503 } : { json: fixture.charge } },
    { match: '/v1/checkout/sessions?', reply: () => ({ json: { data: fixture.invoiceMode ? [] : [fixture.session], has_more: false } }) },
    { match: '/v1/invoice_payments?', reply: () => ({ json: { data: fixture.payments, has_more: false } }) },
    { match: '/v1/invoices/', reply: () => ({ json: fixture.invoice }) },
    { match: '/v1/subscriptions/', reply: () => ({ json: fixture.subscription }) },
    { match: '/v1/refunds?', reply: (url) => ({ json: { data: fixture.paginated ? (url.includes('starting_after') ? fixture.refunds.slice(1) : fixture.refunds.slice(0, 1)) : fixture.refunds,
      has_more: fixture.paginated && !url.includes('starting_after') } }) },
    { match: '/v1/refunds/', reply: (url) => ({ json: fixture.refunds.find((r) => url.endsWith('/' + r.id)) }) }
  ]);
  const send = async (type = 'charge.succeeded', options = {}) => {
    const event = makeEvent(type, { id: type.startsWith('refund.') ? fixture.refunds[0]?.id : fixture.charge.id }, { livemode: false, ...options });
    const response = await postWebhook(onRequest, env, event);
    return { response, event };
  };
  const totals = () => db.prepare('SELECT * FROM stripe_collected_payment_totals').first();
  try {
    await run({ db, env, fixture, stub, send, totals });
    assert.equal(stub.calls.filter((c) => c.url.includes('google-analytics')).length, 0, 'financial storage is not Analytics consent');
    console.log('PASS ' + name); tests++;
  } finally { stub.restore(); db.close(); }
}
const refund = (extra = {}) => ({ id: 're_partial', charge: 'ch_paid', amount: 500,
  currency: 'usd', created: 1789801000, status: 'succeeded', ...extra });

await test('discounted pack records captured cash, duplicate events do not inflate it', async ({ db, send, totals }) => {
  const { response, event } = await send(); assert.equal(response.status, 200);
  assert.deepEqual(await totals(), { environment: 'qa', livemode: 0, currency: 'usd', gross_captured: 1950, refunded: 0, net_collected: 1950 });
  assert.equal((await send('charge.succeeded', { id: event.id })).response.status, 200);
  assert.equal((await send('charge.captured')).response.status, 200);
  assert.equal((await totals()).gross_captured, 1950);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM stripe_collected_payments').first('COUNT(*)'), 1);
});

await test('verified tax breakdown persists atomically with a payment and is stable on replay', async ({fixture,send,db}) => {
  fixture.session={...fixture.session,amount_total:1950,currency:'usd',total_details:{amount_shipping:0,amount_tax:150}};
  assert.equal((await send()).response.status,200);
  assert.deepEqual(await db.prepare('SELECT * FROM stripe_payment_analytics_values').first(),
    {charge_id:'ch_paid',captured_minor:1950,value_minor:1800,tax_minor:150,currency:'usd',item_id:'jobhackai_one_time'});
  await send('charge.captured');
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM stripe_payment_analytics_values').first('n'),1);
});

await test('missing analytics schema retries the webhook without marking partial financial success', async ({fixture,send,db,totals}) => {
  fixture.session={...fixture.session,amount_total:1950,currency:'usd',total_details:{amount_shipping:0,amount_tax:0}};
  db.exec('DROP TABLE stripe_payment_analytics_values');
  assert.equal((await send()).response.status,503);
  assert.equal(await totals(),null);
});

await test('initial subscription and renewal are distinct captured charges', async ({ fixture, send, totals }) => {
  fixture.session.mode = 'subscription'; fixture.session.subscription = 'sub_month';
  fixture.session.payment_intent = null; // Stripe exposes this field only in payment mode.
  fixture.charge.amount_captured = 3400;
  assert.equal((await send()).response.status, 200);
  fixture.invoiceMode = true; // A renewal has no new Checkout Session.
  fixture.charge = { ...fixture.charge, id: 'ch_renewal', payment_intent: 'pi_renewal', amount_captured: 1700 };
  fixture.payments[0] = { ...fixture.payments[0], invoice: 'in_renewal', payment: { type: 'payment_intent', payment_intent: 'pi_renewal' } };
  fixture.invoice.id = 'in_renewal';
  assert.equal((await send()).response.status, 200);
  assert.equal((await totals()).gross_captured, 5100, 'renewal discount uses captured amount, not the $34 list price');
});

await test('subscription checkout without a PaymentIntent still requires the exact invoice subscription', async ({ fixture, send, totals }) => {
  fixture.session.mode = 'subscription'; fixture.session.subscription = 'sub_other';
  fixture.session.payment_intent = null;
  assert.equal((await send()).response.status,503);
  assert.equal(await totals(),null);
});

await test('one-time checkout cannot omit or mismatch its PaymentIntent', async ({ fixture, send, totals }) => {
  for (const value of [null,'pi_other']) {
    fixture.session.payment_intent=value;
    assert.equal((await send()).response.status,503);
    assert.equal(await totals(),null);
  }
});

await test('currencies remain separate integer minor-unit totals', async ({ fixture, send, db }) => {
  await send();
  fixture.charge = { ...fixture.charge, id: 'ch_yen', payment_intent: 'pi_yen', currency: 'jpy', amount_captured: 1000 };
  fixture.session = { ...fixture.session, id: 'cs_yen', payment_intent: 'pi_yen' };
  assert.equal((await send()).response.status, 200);
  assert.deepEqual((await db.prepare('SELECT currency, gross_captured FROM stripe_collected_payment_totals ORDER BY currency').all()).results,
    [{ currency: 'jpy', gross_captured: 1000 }, { currency: 'usd', gross_captured: 1950 }]);
});

await test('charge before checkout completion retries without inventing revenue', async ({ fixture, send, totals }) => {
  fixture.session.status = 'open';
  const attempt = await send(); assert.equal(attempt.response.status, 503); assert.equal(await totals(), null);
  fixture.session.status = 'complete';
  assert.equal((await send('charge.succeeded', { id: attempt.event.id })).response.status, 200);
});

await test('authorization is not revenue; subsequent capture is', async ({ fixture, send, totals }) => {
  fixture.charge.amount_captured = 0; fixture.charge.captured = false;
  assert.equal((await send()).response.status, 200); assert.equal(await totals(), null);
  fixture.charge.amount_captured = 1000; fixture.charge.captured = true;
  assert.equal((await send('charge.captured')).response.status, 200);
  fixture.charge.amount_captured = 1200;
  await send('charge.captured');
  fixture.charge.amount_captured = 1000;
  await send();
  assert.equal((await totals()).gross_captured, 1200, 'stale capture snapshots cannot reduce collected money');
});

await test('partial refunds before purchase and paginated replay remain exact', async ({ fixture, send, totals, stub }) => {
  fixture.refunds = [refund(), refund({ id: 're_second', amount: 200 })]; fixture.paginated = true;
  assert.equal((await send('refund.created')).response.status, 200);
  assert.equal((await totals()).net_collected, 1250);
  await send('charge.succeeded'); await send('charge.refunded');
  assert.equal((await totals()).refunded, 700);
  assert(stub.calls.some((call) => call.url.includes('starting_after=re_partial')));
});

await test('pending and failed refunds do not reduce revenue; failed reversal restores it', async ({ fixture, send, totals }) => {
  fixture.refunds = [refund({ status: 'pending' })];
  await send('refund.created'); assert.equal((await totals()).refunded, 0);
  fixture.refunds[0].status = 'succeeded';
  await send('refund.updated'); assert.equal((await totals()).refunded, 500);
  fixture.refunds[0].status = 'pending';
  await send('refund.updated'); assert.equal((await totals()).refunded, 500, 'stale pending cannot undo success');
  fixture.refunds[0].status = 'failed';
  await send('refund.failed'); assert.equal((await totals()).refunded, 0);
  fixture.refunds[0].status = 'succeeded';
  await send('refund.updated'); assert.equal((await totals()).refunded, 0, 'terminal failure wins over a stale success');
});

await test('foreign checkout or subscription environments record no money', async ({ fixture, send, totals }) => {
  fixture.session.metadata.environment = 'dev';
  assert.equal((await send()).response.status, 200); assert.equal(await totals(), null);
  fixture.invoiceMode = true;
  fixture.invoice.parent.subscription_details.metadata.environment = 'dev'; fixture.subscription.metadata.environment = 'dev';
  assert.equal((await send()).response.status, 200); assert.equal(await totals(), null);
});

await test('unresolved context and transient Stripe failure stay retryable', async ({ fixture, send, db, totals }) => {
  delete fixture.session.metadata.environment;
  const attempt = await send(); assert.equal(attempt.response.status, 503); assert.equal(await totals(), null);
  assert.equal((await db.prepare('SELECT status FROM stripe_event_ledger WHERE event_id=?').bind(attempt.event.id).first()).status, 'failed');
  fixture.session.metadata.environment = 'qa'; fixture.failRead = true;
  assert.equal((await send('charge.succeeded', { id: attempt.event.id })).response.status, 503);
  fixture.failRead = false;
  assert.equal((await send('charge.succeeded', { id: attempt.event.id })).response.status, 200);
});

await test('conflicting subscription stamps and customer mismatch fail closed', async ({ fixture, send, totals }) => {
  fixture.invoiceMode = true; fixture.subscription.metadata.environment = 'dev';
  assert.equal((await send()).response.status, 503);
  fixture.subscription.metadata.environment = 'qa'; fixture.invoice.customer = 'cus_wrong';
  assert.equal((await send()).response.status, 503); assert.equal(await totals(), null);
});

await test('unsupported allocation across invoices is visible, never guessed', async ({ fixture, send, totals }) => {
  fixture.invoiceMode = true;
  fixture.payments.push({ ...fixture.payments[0], id: 'inpay_two', invoice: 'in_other' });
  assert.equal((await send()).response.status, 503); assert.equal(await totals(), null);
});

await test('invalid refund rolls back payment and event completion together', async ({ fixture, send, totals, db }) => {
  fixture.refunds = [refund({ status: 'invalid' })];
  const attempt = await send(); assert.equal(attempt.response.status, 503);
  assert.equal(await totals(), null, 'real SQLite rolls back the preceding payment INSERT');
  assert.equal(await db.prepare('SELECT COUNT(*) FROM stripe_payment_refunds').first('COUNT(*)'), 0);
  assert.equal((await db.prepare('SELECT status FROM stripe_event_ledger WHERE event_id=?').bind(attempt.event.id).first()).status, 'failed');
  fixture.refunds[0].status = 'succeeded';
  assert.equal((await send('charge.succeeded', { id: attempt.event.id })).response.status, 200);
  assert.equal((await totals()).net_collected, 1450);
});

await test('missing migration cannot consume a money event', async ({ db, send }) => {
  db.exec('DROP TABLE analytics_delivery; DROP TABLE stripe_payment_analytics_values; DROP TABLE stripe_payment_attributions; DROP VIEW stripe_campaign_revenue; DROP VIEW stripe_collected_payment_totals; DROP TABLE stripe_payment_refunds; DROP TABLE stripe_collected_payments;');
  const attempt = await send(); assert.equal(attempt.response.status, 503);
  assert.equal((await db.prepare('SELECT status FROM stripe_event_ledger WHERE event_id=?').bind(attempt.event.id).first()).status, 'failed');
});

await test('wrong mode performs no ledger writes or Stripe reads', async ({ send, db, stub }) => {
  assert.equal((await send('charge.succeeded', { livemode: true })).response.status, 200);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM stripe_event_ledger').first('COUNT(*)'), 0);
  assert.equal(stub.calls.length, 0);
});

await test('currency changes and malformed values cannot overwrite a known payment', async ({ fixture, send, totals }) => {
  await send(); fixture.charge.currency = 'jpy';
  assert.equal((await send()).response.status, 503); assert.equal((await totals()).currency, 'usd');
  fixture.charge.currency = 'usd'; fixture.charge.amount_captured = 19.5;
  assert.equal((await send()).response.status, 503); assert.equal((await totals()).gross_captured, 1950);
});



await test('signed charge event links consented checkout context in its atomic financial batch',async({db,fixture,send})=>{
  db.exec(`INSERT INTO users(id,auth_id) VALUES(42,'attributed-owner');
    INSERT INTO cookie_consents(user_id,consent_json) VALUES(42,'{"version":1,"analytics":true}');`);
  await db.prepare(`INSERT INTO checkout_attributions(checkout_session_id,user_id,client_id,stripe_customer_id,environment,ga_client_id,first_touch_json,captured_at,expires_at) VALUES('cs_pack',42,'7bbba230-b755-4d31-b475-e20cf6d00ed9','cus_owner','qa','123.456','{"source":"linkedin","medium":"social","campaign":"qa_voice"}',?,?)`).bind(fixture.charge.created*1000-1000,Date.now()+86400000).run();
  assert.equal((await send()).response.status,200);
  assert.equal(await db.prepare('SELECT checkout_session_id FROM stripe_payment_attributions').first('checkout_session_id'),'cs_pack');
  assert.equal(await db.prepare('SELECT net_collected FROM stripe_campaign_revenue').first('net_collected'),1950);
});
await test('missing attribution migration rolls back money and leaves the webhook retryable',async({db,send})=>{
  db.exec('DROP TABLE stripe_payment_attributions;');
  assert.equal((await send()).response.status,503);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM stripe_collected_payments').first('n'),0);
  assert.equal(await db.prepare('SELECT status FROM stripe_event_ledger').first('status'),'failed');
});

console.log(`${tests} real SQLite revenue/webhook tests passed`);
