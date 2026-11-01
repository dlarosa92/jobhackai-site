// Native observations are compared with read-only application records. This never
// changes a payment, entitlement, customer, refund, or production ledger row.
import { easternDay, metricPeriods } from './business-metrics.js';
import { digest } from './outreach-policy.js';
export const STRIPE_ACCOUNT = 'acct_1RymDCApMPhcB1Y6';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const id = (v, prefix) => { if (typeof v !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`).test(v)) fail('Invalid Stripe identifier.'); return v; };
const date = v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '') || !Number.isFinite(Date.parse(`${v}T12:00:00Z`)) || new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) !== v) fail('Invalid observation date.'); return v; };
const amount = v => { if (!Number.isSafeInteger(v) || v <= 0 || v > 100000000) fail('Invalid USD amount.'); return v; };
const list = (v, map) => { if (!Array.isArray(v) || v.length > 2000) fail('Supply a bounded complete observation.'); return v.map(map); };
const sort = rows => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const internal = email => /@jobhackai\.io$/i.test(email || '') || /^dlarosa92(?:\+[^@]+)?@gmail\.com$/i.test(email || '');
export function validateStripeCheck(input, now = new Date()) {
  if (!input || input.account !== STRIPE_ACCOUNT || input.livemode !== true) fail('Use the JobHackAI live Stripe account.');
  const time = Date.parse(input.checkedAt);
  if (!Number.isFinite(time) || time > now.getTime() + 60000 || now.getTime() - time > 2 * 3600000) fail('A fresh native Stripe observation is required.');
  const checkedAt = new Date(time).toISOString();
  if (input.status === 'unavailable') {
    if (typeof input.detail !== 'string' || !input.detail.trim() || input.detail.length > 2000) fail('Explain the failed Stripe read.');
    return { account: STRIPE_ACCOUNT, livemode: true, checkedAt, status: 'unavailable', detail: input.detail };
  }
  const period = metricPeriods(now, 28);
  if (input.startDate !== period.previousStart || input.endDate !== period.end) fail('Read all 56 complete Eastern days ending yesterday, including refunds on older payments.');
  for (const scope of ['payments', 'refunds', 'activeSubscriptions']) if (input.complete?.[scope] !== true) fail(`The ${scope} observation must include every page.`);
  const sourceUrls = list(input.sourceUrls, value => {
    let u; try { u = new URL(value); } catch { fail('Use native Stripe evidence URLs.'); }
    if (u.protocol !== 'https:' || u.hostname !== 'dashboard.stripe.com' || u.username || u.password || u.port || !u.pathname.startsWith(`/${STRIPE_ACCOUNT}/`) || /\/test\//.test(u.pathname)) fail('Use native live Stripe evidence URLs.');
    return u.href;
  });
  if (!sourceUrls.length) fail('Native evidence is required.');
  const charges = list(input.charges, r => ({ paymentId: id(r.paymentId, 'pi'), customerId: id(r.customerId, 'cus'), date: date(r.date), amount: amount(r.amount) }));
  const refunds = list(input.refunds, r => ({ paymentId: id(r.paymentId, 'pi'), date: date(r.date), amount: amount(r.amount) }));
  const subscriptions = list(input.subscriptions, r => ({ id: id(r.id, 'sub'), customerId: id(r.customerId, 'cus') }));
  if (new Set(charges.map(r => r.paymentId)).size !== charges.length || new Set(subscriptions.map(r => r.id)).size !== subscriptions.length || new Set(refunds.map(r => `${r.paymentId}:${r.date}`)).size !== refunds.length) fail('Duplicate observation rows. Group succeeded refunds by payment and Eastern date.');
  if ([...charges, ...refunds].some(r => r.date < input.startDate || r.date > input.endDate)) fail('Observation row outside the selected window.');
  return { account: STRIPE_ACCOUNT, livemode: true, checkedAt, status: 'observed', startDate: input.startDate, endDate: input.endDate, sourceUrls, charges: sort(charges), refunds: sort(refunds), subscriptions: sort(subscriptions) };
}
export async function readStripeBasis(db, now = new Date()) {
  const period = metricPeriods(now, 28), since = Math.floor(Date.parse(`${period.previousStart}T00:00:00Z`) / 1000);
  const [charges, refunds, users] = await Promise.all([
    db.prepare("SELECT payment_intent_id,customer_id,charge_created_at,amount_captured FROM stripe_collected_payments WHERE environment='prod' AND livemode=1 AND currency='usd' AND charge_created_at>=?").bind(since).all(),
    db.prepare("SELECT p.payment_intent_id,r.refund_created_at,r.amount FROM stripe_payment_refunds r JOIN stripe_collected_payments p ON p.charge_id=r.charge_id WHERE p.environment='prod' AND p.livemode=1 AND p.currency='usd' AND r.currency='usd' AND r.status='succeeded' AND r.refund_created_at>=?").bind(since).all(),
    db.prepare("SELECT email,plan,stripe_customer_id,stripe_subscription_id,subscription_status,current_period_end,voice_sessions_remaining,pack_expires_at FROM users WHERE stripe_customer_id IS NOT NULL OR voice_sessions_remaining>0 OR (plan IS NOT NULL AND plan!='free')").all(),
  ]);
  const inWindow = r => r.date >= period.previousStart && r.date <= period.end;
  const captured = charges.results.map(r => ({ paymentId: r.payment_intent_id, customerId: r.customer_id, date: easternDay(new Date(r.charge_created_at * 1000)), amount: r.amount_captured })).filter(inWindow);
  const refunded = new Map();
  for (const r of refunds.results) { const row = { paymentId: r.payment_intent_id, date: easternDay(new Date(r.refund_created_at * 1000)), amount: r.amount }; if (!inWindow(row)) continue; const key = `${row.paymentId}:${row.date}`; if (refunded.has(key)) refunded.get(key).amount += row.amount; else refunded.set(key, row); }
  const accounts = users.results.map(r => ({ customerId: r.stripe_customer_id, subscriptionId: r.stripe_subscription_id, status: r.subscription_status, plan: r.plan, until: r.current_period_end, credits: r.voice_sessions_remaining, expires: r.pack_expires_at, internal: internal(r.email) }));
  const basis = { startDate: period.previousStart, endDate: period.end, charges: sort(captured), refunds: sort([...refunded.values()]), accounts: sort(accounts) };
  return { ...basis, fingerprint: await digest(basis) };
}
export async function compareStripeCheck(report, basis, now = new Date()) {
  const issues = [];
  if (JSON.stringify(report.charges) !== JSON.stringify(basis.charges)) issues.push('Saved payments do not match Stripe.');
  if (JSON.stringify(report.refunds) !== JSON.stringify(basis.refunds)) issues.push('Saved refunds do not match Stripe.');
  const paid = new Set(), activeIds = new Set(report.subscriptions.map(s => s.id));
  for (const sub of report.subscriptions) {
    const matched = basis.accounts.filter(a => a.customerId === sub.customerId && a.subscriptionId === sub.id);
    if (matched.length !== 1 || matched[0].status !== 'active' || !matched[0].plan || matched[0].plan === 'free' || !(Date.parse(matched[0].until) > now.getTime())) { issues.push('A Stripe subscription does not match current app access.'); continue; }
    if (!matched[0].internal) {
      const payments=basis.charges.filter(c=>c.customerId===sub.customerId), ids=new Set(payments.map(c=>c.paymentId));
      const net=payments.reduce((sum,c)=>sum+c.amount,0)-basis.refunds.filter(r=>ids.has(r.paymentId)).reduce((sum,r)=>sum+r.amount,0);
      if(net>0)paid.add(sub.customerId);else issues.push('An active paid account needs payment evidence outside this window.');
    }
  }
  for (const account of basis.accounts) {
    if (account.status === 'active' && account.plan !== 'free' && Date.parse(account.until) > now.getTime() && !activeIds.has(account.subscriptionId)) issues.push('App access has an active subscription missing from Stripe.');
    if (!account.internal && account.credits > 0 && Date.parse(account.expires) > now.getTime()) issues.push('Paid interview-pack access needs a purchase-to-credit check.');
  }
  return { status: issues.length ? 'incomplete' : 'current', issues: [...new Set(issues)], customers: issues.length ? null : paid.size, fingerprint: basis.fingerprint };
}
export async function stripeCheckStatus(env, now = new Date()) {
  let row;
  try { row = await env.DASHBOARD_DB.prepare('SELECT payload FROM stripe_checks ORDER BY checked_at DESC,id DESC LIMIT 1').first(); }
  catch { return { status: 'unavailable', detail: 'Stripe checks are not set up yet.' }; }
  if (!row) return { status: 'unavailable', detail: 'Run the first Stripe comparison.' };
  const saved = JSON.parse(row.payload), report = saved.observation;
  if (report.status === 'unavailable') return { status: 'unavailable', checkedAt: report.checkedAt, detail: report.detail };
  const base = { checkedAt: report.checkedAt, sourceUrls: report.sourceUrls };
  if (now.getTime() - Date.parse(report.checkedAt) > 30 * 3600000 || report.endDate !== metricPeriods(now, 28).end) return { ...base, status: 'stale', detail: 'The Stripe comparison is out of date. Run a new check.' };
  let basis; try { basis = await readStripeBasis(env.PRODUCTION_DB, now); } catch { return { ...base, status: 'unavailable', detail: 'Could not reread the app records for the Stripe check.' }; }
  if (saved.result.fingerprint !== basis.fingerprint) return { ...base, status: 'incomplete', detail: 'App records changed after the Stripe check. Compare again.' };
  // Reevaluate time-dependent access even when the stored records did not change.
  const result = await compareStripeCheck(report, basis, now);
  return { ...base, ...result, detail: result.status === 'current' ? 'Payments, refunds and current paid accounts match Stripe. Staff accounts are excluded from paying customers.' : result.issues.join(' ') };
}
export async function stripeCheckApi(request, env, now = new Date()) {
  const response = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (request.method === 'GET') { const { status, checkedAt, detail } = await stripeCheckStatus(env, now); return response({ status, checkedAt, detail }); }
    if (request.method !== 'POST') fail('Method not allowed.', 405);
    const reader = request.body?.getReader(); if (!reader) fail('Missing observation.'); let size = 0; const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 262144) { await reader.cancel(); fail('Observation too large.', 413); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let input; try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('Invalid JSON.'); }
    const observation = validateStripeCheck(input, now);
    const result = observation.status === 'unavailable' ? null : await compareStripeCheck(observation, await readStripeBasis(env.PRODUCTION_DB, now), now);
    const payload = JSON.stringify({ observation, result }), key = `stripe-${observation.checkedAt}`;
    const prior = await env.DASHBOARD_DB.prepare('SELECT payload FROM stripe_checks WHERE id=?').bind(key).first();
    if (prior && prior.payload !== payload) fail('This observation already exists with different data.', 409);
    await env.DASHBOARD_DB.prepare('INSERT INTO stripe_checks(id,checked_at,payload) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(key, observation.checkedAt, payload).run();
    // Importers receive no raw app records, counts, costs, or ledger data.
    return response({ saved: true, id: key, status: result?.status || 'unavailable' });
  } catch (error) { if (error.status) return response({ error: error.message }, error.status); throw error; }
}
