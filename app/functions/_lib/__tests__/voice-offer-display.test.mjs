import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../../../', import.meta.url);
const script = readFileSync(new URL('js/voice-cta.js', root), 'utf8');
const pricing = readFileSync(new URL('pricing.html', root), 'utf8');
const cases = [
  { name: 'unused free session', voice: { enabled: true, canStart: true, mode: 'free' }, label: 'Start your free voice interview', href: 'voice-interview.html', text: 'feedback preview' },
  { name: 'subscriber', voice: { enabled: true, canStart: true, mode: 'subscription' }, label: 'Start a voice interview', href: 'voice-interview.html', text: 'full scored report' },
  { name: 'pack holder', voice: { enabled: true, canStart: true, mode: 'pack' }, label: 'Start a voice interview', href: 'voice-interview.html', text: 'full scored report' },
  { name: 'free session exhausted', voice: { enabled: true, canStart: false, reason: 'paywall' }, label: 'Explore voice interview plans', href: 'pricing.html', text: 'Choose a plan' },
  { name: 'monthly cap reached', voice: { enabled: true, canStart: false, mode: 'subscription', reason: 'limit_reached' }, label: 'View your interview history', href: 'voice-interview.html#vi-history-list', text: 'UTC calendar month' },
  { name: 'feature disabled', voice: { enabled: false }, label: null },
  { name: 'unavailable entitlement', voice: null, label: null },
  { name: 'partial entitlement', voice: { enabled: true }, label: null },
  { name: 'signed out', signedOut: true, voice: { enabled: true, canStart: true, mode: 'free' }, label: null }
];

async function render(fixture, page) {
  const inserted = [];
  const button = { textContent: 'Start practicing', href: 'voice-interview.html' };
  const detail = { textContent: 'One lifetime free interview with a feedback preview.' };
  const anchor = { children: [{}], parentNode: { insertBefore: box => inserted.push(box) } };
  const intervals = [];
  const document = {
    readyState: 'complete', addEventListener() {},
    querySelector: selector => selector === '.vp-hero-cta' ? button : selector === '.vp-hero-sub' ? detail :
      selector === '.jha-voice-cta' ? inserted[0] : anchor,
    createElement: () => ({ setAttribute() {}, innerHTML: '' })
  };
  const user = fixture.signedOut ? null : { getIdToken: async () => 'fixture-token' };
  const context = {
    document, console,
    window: { location: { pathname: '/' + page },
      FirebaseAuthManager: { getCurrentUser: () => user, waitForAuthReady: async () => user },
      PlanCache: { getPlan: async () => ({ voice: fixture.voice }) } },
    fetch: async () => ({ ok: false }),
    setInterval: fn => { intervals.push(fn); return 1; }, clearInterval() {}
  };
  vm.runInNewContext(script, context);
  // Two overlapping ticks must still insert a single CTA.
  await Promise.all(intervals.flatMap(fn => [fn(), fn()]));
  await new Promise(resolve => setImmediate(resolve));
  return { inserted, button, detail };
}

for (const fixture of cases) {
  test(`tool and pricing offers: ${fixture.name}`, async () => {
    const tool = await render(fixture, 'interview-questions.html');
    const page = await render(fixture, 'pricing');
    if (!fixture.label) {
      assert.equal(tool.inserted.length, 0);
      assert.equal(page.button.textContent, 'Start practicing');
      return;
    }
    assert.equal(tool.inserted.length, 1);
    assert.ok(tool.inserted[0].innerHTML.includes(fixture.label));
    assert.ok(tool.inserted[0].innerHTML.includes(fixture.text));
    assert.equal(page.button.textContent, fixture.label);
    assert.equal(page.button.href, fixture.href === 'pricing.html' ? '#plans' : fixture.href);
    assert.ok(page.detail.textContent.includes(fixture.text));
    const [path, hash] = fixture.href.split('#');
    assert.ok(existsSync(new URL(path, root)), 'offer destination exists');
    if (hash) assert.ok(readFileSync(new URL(path, root), 'utf8').includes(`id="${hash}"`));
  });
}
test('pricing includes its offer controller and an actual plan anchor', () => {
  assert.ok(pricing.includes('src="js/voice-cta.js"'));
  assert.ok(pricing.includes('id="plans"'));
  assert.ok(!pricing.includes('>Try your first voice interview free</a>'));
});
