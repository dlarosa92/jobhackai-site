// pricing.html ?plan= preselect, used by the voice report's plan picker.
// Run: node --test app/functions/_lib/__tests__/pricing-preselect.test.mjs
//
// Runs the page's real checkout script against a minimal DOM: the linked
// card is highlighted and its button focused, and nothing starts checkout.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../../../../pricing.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).find(value => value.includes('function preselectPlan('));

function mount(search) {
  const cards = {}, buttons = {}, fetches = [];
  for (const plan of ['weekly', 'monthly', 'pack']) {
    const classes = new Set();
    cards[plan] = { classList: { add: c => classes.add(c), has: c => classes.has(c) } };
    buttons[plan] = { dataset: { plan }, focused: false, focus() { this.focused = true; },
      closest: selector => (selector === '.vp-card' ? cards[plan] : null), addEventListener() {} };
  }
  let ready = null;
  const document = {
    addEventListener: (type, callback) => { if (type === 'DOMContentLoaded') ready = callback; },
    querySelector: selector => {
      const plan = selector.match(/^\.vp-buy\[data-plan="([^"]+)"\]$/)?.[1];
      return plan ? buttons[plan] || null : null;
    },
    querySelectorAll: selector => (selector === '.vp-buy' ? Object.values(buttons) : [])
  };
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const ctx = { document, URLSearchParams, localStorage: storage, sessionStorage: storage, console,
    fetch: async (...args) => { fetches.push(args); throw new Error('no network in tests'); },
    location: { search, href: 'https://app.jobhackai.io/pricing' + search }, setTimeout, clearTimeout, WeakMap };
  ctx.window = { ...ctx, addEventListener() {} };
  ctx.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  ready();
  return { cards, buttons, fetches };
}

test('the pricing page has the preselect script', () => {
  assert.ok(script, 'preselectPlan lives in the pricing checkout script');
});

for (const plan of ['weekly', 'monthly', 'pack']) {
  test(`?plan=${plan} highlights that card and focuses its button`, () => {
    const page = mount('?plan=' + plan);
    assert.ok(page.cards[plan].classList.has('vp-card--selected'));
    assert.equal(page.buttons[plan].focused, true);
    for (const other of ['weekly', 'monthly', 'pack'].filter(p => p !== plan)) {
      assert.ok(!page.cards[other].classList.has('vp-card--selected'), other);
    }
    assert.equal(page.fetches.length, 0, 'preselecting never starts checkout');
  });
}

for (const search of ['', '?plan=enterprise', '?plan=__proto__', '?utm_source=linkedin']) {
  test(`no preselect for "${search || 'no query'}"`, () => {
    const page = mount(search);
    for (const plan of ['weekly', 'monthly', 'pack']) {
      assert.ok(!page.cards[plan].classList.has('vp-card--selected'), plan);
      assert.equal(page.buttons[plan].focused, false, plan);
    }
  });
}
