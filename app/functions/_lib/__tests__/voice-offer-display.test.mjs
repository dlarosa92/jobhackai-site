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

async function render(fixture, page, delayedAuth = false) {
  const inserted = [];
  const button = { textContent: 'Start practicing', href: 'voice-interview.html' };
  const detail = { textContent: 'One lifetime free interview with a feedback preview.' };
  const anchor = { children: [{}], parentNode: { insertBefore: box => inserted.push(box) } };
  const intervals = [];
  const listeners = new Map();
  const document = {
    readyState: 'complete', addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    removeEventListener(name, fn) {
      listeners.set(name, (listeners.get(name) || []).filter(value => value !== fn));
    },
    querySelector: selector => selector === '.vp-hero-cta' ? button : selector === '.vp-hero-sub' ? detail :
      selector === '.jha-voice-cta' ? inserted[0] : anchor,
    createElement: () => ({ setAttribute() {}, innerHTML: '' })
  };
  const user = fixture.signedOut ? null : { getIdToken: async () => 'fixture-token' };
  const manager = { getCurrentUser: () => user, waitForAuthReady: async () => user };
  const context = {
    document, console,
    window: { location: { pathname: '/' + page },
      FirebaseAuthManager: delayedAuth ? undefined : manager,
      PlanCache: { getPlan: async () => ({ voice: fixture.voice }) } },
    fetch: async () => ({ ok: false }),
    setInterval: fn => { intervals.push(fn); return 1; }, clearInterval() {}
  };
  vm.runInNewContext(script, context);
  if (delayedAuth) {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button.textContent, 'Start practicing');
    assert.equal(inserted.length, 0);
    assert.equal(intervals.length, 0, 'no watcher while Firebase is unavailable');
    if (delayedAuth !== 'never') {
      context.window.FirebaseAuthManager = manager;
      for (const fn of listeners.get('firebase-auth-ready') || []) fn();
    }
  }
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

test('cold loads personalize tool and pricing offers after the auth module arrives', async () => {
  for (const name of ['subscriber', 'monthly cap reached', 'free session exhausted']) {
    const fixture = cases.find(value => value.name === name);
    const page = await render(fixture, 'pricing', true);
    const tool = await render(fixture, 'interview-questions.html', true);
    assert.equal(page.button.textContent, fixture.label);
    assert.equal(page.button.href, fixture.href === 'pricing.html' ? '#plans' : fixture.href);
    assert.equal(tool.inserted.length, 1);
    assert.ok(tool.inserted[0].innerHTML.includes(fixture.label));
  }
});

test('cold signed-out load retains a neutral offer after auth resolves', async () => {
  const fixture = cases.find(value => value.name === 'signed out');
  const page = await render(fixture, 'pricing', true);
  const tool = await render(fixture, 'interview-questions.html', true);
  assert.equal(page.button.textContent, 'Start practicing');
  assert.equal(tool.inserted.length, 0);
});

test('a failed Firebase module leaves neutral offers without starting any watcher', async () => {
  const fixture = cases.find(value => value.name === 'subscriber');
  const page = await render(fixture, 'pricing', 'never');
  const tool = await render(fixture, 'interview-questions.html', 'never');
  assert.equal(page.button.textContent, 'Start practicing');
  assert.equal(tool.inserted.length, 0);
});

test('all served pricing paths show the exhausted-account offer', async () => {
  const fixture = cases.find(value => value.name === 'free session exhausted');
  for (const path of ['pricing', 'pricing/', 'pricing.html']) {
    const page = await render(fixture, path);
    assert.equal(page.button.textContent, fixture.label, path);
    assert.equal(page.button.href, '#plans', path);
  }
});
