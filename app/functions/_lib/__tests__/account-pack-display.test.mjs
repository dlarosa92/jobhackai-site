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
  { billing: 'free', voice: { enabled: false, lookupStatus: 'ready', mode: 'free', sessionsRemaining: 0 }, expected: 'Free Account', cached: 'free' },
  { billing: 'free', voice: { enabled: false, lookupStatus: 'ready', mode: 'pack', sessionsRemaining: 4, packExpiresAt: '2099-12-31T12:00:00.000Z' }, expected: 'Interview Pack', cached: 'pack', initial: 'free' },
  { billing: 'monthly', voice: { mode: 'subscription', sessionsRemaining: 4 }, expected: 'Monthly Plan', cached: 'monthly' },
  { billing:'weekly', voice:{mode:'subscription'}, status:'active', currentPeriodEnd:1790481600000, cancelAt:1790481600000, metaCancelAt:null, expected:'will cancel', absent:'Renews on', cached:'weekly' },
  { billing:'weekly', voice:{mode:'subscription'}, status:'active', currentPeriodEnd:1790481600000, cancelAt:null, metaCancelAt:1790481600000, expected:'Renews on', absent:'will cancel', cached:'weekly' }
]) {
  const section = { innerHTML: '' }, store = new Map(fixture.initial ? [['user-plan', fixture.initial], ['dev-plan', fixture.initial]] : []);
  const ctx = {
    document: { getElementById: () => section },
    window: { FirebaseAuthManager: { getCurrentUser: () => ({ getIdToken: async () => 'fixture' }) }, dispatchEvent() {} },
    localStorage: { getItem: k => store.get(k), setItem: (k,v) => store.set(k,v) },
    CustomEvent: class {}, console,
    fetch: async url => ({ ok: true, json: async () => url.includes('billing-status') ? { ok: true, plan: fixture.billing, status:fixture.status, currentPeriodEnd:fixture.currentPeriodEnd, cancelAt:fixture.cancelAt } : { plan: 'free', voice: { enabled: true, ...fixture.voice }, cancelAt:fixture.metaCancelAt } })
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
// A transient entitlement failure must not downgrade the cache, dispatch a
// plan change, or present a paid pack owner as a free customer.
for (const failure of ['network', 'http', 'json', 'missing', 'backend']) {
  const section = { innerHTML: '' };
  const store = new Map([['user-plan', 'pack'], ['dev-plan', 'pack']]);
  let changes = 0;
  const ctx = {
    document: { getElementById: () => section },
    window: { FirebaseAuthManager: { getCurrentUser: () => ({ getIdToken: async () => 'fixture' }) }, dispatchEvent() { changes++; } },
    localStorage: { getItem: k => store.get(k), setItem: (k,v) => store.set(k,v) },
    CustomEvent: class {}, console,
    fetch: async url => {
      if (url.includes('billing-status')) return { ok: true, json: async () => ({ ok: true, plan: 'free' }) };
      if (failure === 'network') throw Error('offline');
      return { ok: failure !== 'http', json: async () => {
        if (failure === 'json') throw Error('invalid JSON');
        return failure === 'backend' ? { voice: { enabled: false, lookupStatus: 'unavailable', reason: 'db_unavailable' } } : {};
      } };
    }
  };
  vm.createContext(ctx);
  await vm.runInContext('let billingSectionRetryCount=0; const MAX_BILLING_RETRIES=3;'+render+';renderBillingSection();', ctx);
  assert.match(section.innerHTML, /Unable to load your interview allowance/, failure);
  assert.doesNotMatch(section.innerHTML, /Free Account/, failure);
  assert.equal(store.get('user-plan'), 'pack', failure);
  assert.equal(store.get('dev-plan'), 'pack', failure);
  assert.equal(changes, 0, failure);
}
console.log('Account settings pack, exhausted pack and subscription displays passed');
