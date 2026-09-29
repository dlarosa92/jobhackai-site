// Run the real account-settings render function against pack/subscription fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../../../../account-setting.html', import.meta.url), 'utf8');
const start = html.indexOf('    async function renderBillingSection()');
const end = html.indexOf('    async function startPaidNow', start);
const render = html.slice(start, end);
for (const fixture of [
  { billing: 'free', voice: { mode: 'pack', sessionsRemaining: 4, packExpiresAt: '2099-12-31T12:00:00.000Z' }, expected: 'Interview Pack', cached: 'pack' },
  { billing: 'free', voice: { mode: null, sessionsRemaining: 0 }, expected: 'Free Account', cached: 'free' },
  { billing: 'monthly', voice: { mode: 'subscription', sessionsRemaining: 4 }, expected: 'Monthly Plan', cached: 'monthly' },
  { billing:'weekly', voice:{mode:'subscription'}, status:'active', currentPeriodEnd:1790481600000, cancelAt:1790481600000, metaCancelAt:null, expected:'will cancel', absent:'Renews on', cached:'weekly' },
  { billing:'weekly', voice:{mode:'subscription'}, status:'active', currentPeriodEnd:1790481600000, cancelAt:null, metaCancelAt:1790481600000, expected:'Renews on', absent:'will cancel', cached:'weekly' }
]) {
  const section = { innerHTML: '' }, store = new Map();
  const ctx = {
    document: { getElementById: () => section },
    window: { FirebaseAuthManager: { getCurrentUser: () => ({ getIdToken: async () => 'fixture' }) }, dispatchEvent() {} },
    localStorage: { getItem: k => store.get(k), setItem: (k,v) => store.set(k,v) },
    CustomEvent: class {}, console,
    fetch: async url => ({ ok: true, json: async () => url.includes('billing-status') ? { ok: true, plan: fixture.billing, status:fixture.status, currentPeriodEnd:fixture.currentPeriodEnd, cancelAt:fixture.cancelAt } : { plan: 'free', voice: fixture.voice, cancelAt:fixture.metaCancelAt } })
  };
  vm.createContext(ctx);
  await vm.runInContext('let billingSectionRetryCount=0; const MAX_BILLING_RETRIES=3;'+render+';renderBillingSection();', ctx);
  assert.ok(section.innerHTML.includes(fixture.expected), section.innerHTML);
  assert.equal(store.get('user-plan'), fixture.cached);
  if (fixture.absent) assert.ok(!section.innerHTML.includes(fixture.absent), section.innerHTML);
  if (fixture.cached === 'pack') {
    assert.ok(!section.innerHTML.includes('Billing Management'));
    assert.ok(section.innerHTML.includes('Valid through') && section.innerHTML.includes('2099'));
  }
}
console.log('Account settings pack, exhausted pack and subscription displays passed');
