import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../../../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const tagged = '?utm_source=linkedin&utm_medium=organic_social&utm_campaign=voice_beta_2026_09&utm_content=tool_link_01';

// Run the real shared consent owner and real tool scripts; vendor scripts are
// collected but never executed, so these tests send no Analytics traffic.
function harness({ consent = true, preview = false } = {}) {
  const listeners = new Map(), nodes = new Map(), cookies = new Map();
  const scripts = [], timers = [], intervals = [], legacyCalls = [];
  const store = new Map([['jha_cookie_consent_v1', JSON.stringify({ version: 1, analytics: consent })]]);
  function element(tagName = 'div') {
    return { tagName, style: {}, children: [{}], classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; }, addEventListener() {}, focus() {},
      remove() {}, querySelector() { return element(); }, parentNode: { insertBefore(e) { scripts.push(e); } } };
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const document = {
    readyState: 'loading', title: 'Interview Questions', referrer: 'https://www.linkedin.com/',
    createElement: element, getElementById: id => id === 'jha-preview-gate' ? null : node(id),
    head: { appendChild(e) { scripts.push(e); } }, body: { style: {}, appendChild() {} },
    addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); },
    removeEventListener() {},
    querySelector(selector) { return selector === '#iq-questions' ? node(selector) : this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) { const part = selector.match(/src\*="([^"]+)"/)?.[1]; return part ? scripts.filter(s => (s.src || '').includes(part)) : []; },
    getElementsByTagName() { return [element('script')]; }
  };
  Object.defineProperty(document, 'cookie', {
    get: () => [...cookies].map(([key, value]) => key + '=' + value).join('; '),
    set(value) { const [pair, ...attrs] = value.split(';'), at = pair.indexOf('=');
      if (attrs.some(a => a.trim() === 'Max-Age=0')) cookies.delete(pair.slice(0, at));
      else cookies.set(pair.slice(0, at), pair.slice(at + 1)); }
  });
  const ctx = { document, URL, CustomEvent: class {}, HTMLScriptElement: class {},
    location: { hostname: 'app.jobhackai.io', protocol: 'https:', pathname: '/interview-questions',
      href: 'https://app.jobhackai.io/interview-questions' + tagged, search: tagged },
    __REAL_AUTH_READY: true, __JHA_PREVIEW_MODE__: preview, JHA_CONFIG: { CLARITY_ID: '' },
    JHA: { analytics: { track(...args) { legacyCalls.push(args); } } },
    FirebaseAuthManager: { getCurrentUser: () => ({ getIdToken: async () => 'fixture-only' }) },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    setTimeout(fn) { timers.push(fn); return timers.length; }, setInterval(fn) { intervals.push(fn); return intervals.length; },
    clearInterval() {}, dispatchEvent() {}, addEventListener() {}, console: { log() {}, warn() {} },
    fetch: async url => ({ ok: !url.includes('/api/plan/me'), json: async () => ({ ok: true, consent: { version: 1, analytics: consent } }) }) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/cookie-consent.js'), ctx);
  // Only strip ESM export declarations; exercise the real class method below.
  vm.runInContext(read('js/role-selector.js').replace(/^export /gm, ''), ctx);
  return { ctx, legacyCalls, scripts,
    async initVoice() { vm.runInContext(read('js/voice-cta.js'), ctx); await this.init(); },
    async init() { for (const callback of listeners.get('DOMContentLoaded') || []) await callback(); while (timers.length) timers.shift()(); },
    async output() { for (const callback of intervals) await callback(); },
    role(name) { const selector = Object.create(ctx.RoleSelector.prototype); selector.roles = [{ name: 'Product Manager' }]; selector.trackSelection(name); },
    events: name => (ctx.dataLayer || []).filter(args => args[0] === 'event' && args[1] === name)
  };
}

for (const [preview, event] of [[true, 'sign_up_gate_view'], [false, 'tool_output_viewed']]) {
  test(event + ' uses the consent owner and retains campaign context', async () => {
    const h = harness({ preview }); await h.initVoice(); await h.output();
    assert.equal(h.legacyCalls.length, 0);
    assert.equal(h.events(event).length, 1);
    assert.equal(h.events(event)[0][2].jha_first_campaign, 'voice_beta_2026_09');
    assert.equal(h.events(event)[0][2].jha_last_asset, 'tool_link_01');
  });
}
test('role selection sends the canonical known role through campaign enrichment', async () => {
  const h = harness(); await h.init(); h.role('product manager');
  const events = h.events('role_selected'); assert.equal(events.length, 1);
  assert.equal(events[0][2].role_name, 'Product Manager');
  assert.equal(events[0][2].role_type, 'standard');
  assert.equal(events[0][2].jha_last_campaign, 'voice_beta_2026_09');
});
test('custom role input never leaves the page in the analytics payload', async () => {
  const h = harness(); await h.init(); h.role('Private Name private@example.com');
  const events = h.events('role_selected'); assert.equal(events.length, 1);
  assert.equal(events[0][2].role_name, 'custom'); assert.equal(events[0][2].role_type, 'custom');
  assert.doesNotMatch(JSON.stringify(Array.from(events[0])), /Private Name|private@example\.com/);
});
for (const preview of [false, true]) {
  test('tool and role events respect denied consent: preview=' + preview, async () => {
    const h = harness({ consent: false, preview }); await h.initVoice(); await h.output(); h.role('Product Manager');
    assert.equal(h.scripts.length, 0); assert.equal(h.legacyCalls.length, 0);
    for (const event of ['sign_up_gate_view', 'tool_output_viewed', 'role_selected']) assert.equal(h.events(event).length, 0);
  });
  test('missing shared tracker never falls back to direct gtag: preview=' + preview, async () => {
    const h = harness({ preview }); delete h.ctx.JHA.trackEventSafe; await h.initVoice(); await h.output(); h.role('Product Manager');
    assert.equal(h.legacyCalls.length, 0);
    for (const event of ['sign_up_gate_view', 'tool_output_viewed', 'role_selected']) assert.equal(h.events(event).length, 0);
  });
}
for (const page of ['cover-letter-generator', 'interview-questions', 'linkedin-optimizer', 'mock-interview', 'resume-feedback-pro']) {
  test(page + ' loads its consent owner before tracking consumers', () => {
    const html = read(page + '.html');
    const scripts = [...html.matchAll(/<script\b([^>]*?)src="([^"]+)"([^>]*)>/gi)];
    const owners = scripts.filter(m => /(?:^|\/)cookie-consent\.js(?:\?|$)/.test(m[2]));
    assert.equal(owners.length, 1); assert.match(owners[0][1] + owners[0][3], /\bdefer\b/);
    const firstConsumer = scripts.find(m => /\/(?:voice-cta|role-selector|analytics|main)\.js(?:\?|$)/.test(m[2]));
    assert.ok(firstConsumer && owners[0].index < firstConsumer.index);
    assert.match(html, /src="js\/firebase-auth\.js[^\"]*"[^>]*type="module"|type="module"[^>]*src="js\/firebase-auth\.js/);
  });
}
