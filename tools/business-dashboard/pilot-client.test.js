import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/pilot-client.js', import.meta.url), 'utf8');
class Element {
  constructor() { this.children = []; this.events = {}; this.textContent = ''; this.disabled = false; this.checked = false; }
  addEventListener(name, callback) { this.events[name] = callback; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  text() { return this.textContent + this.children.map(child => child.text()).join(''); }
}
async function fixture(fetcher) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const fields = { grantId: 'brighton-test-01', email: 'person@example.test', role: 'participant', startsAt: '2026-11-09T09:00', expiresAt: '2026-12-09T09:00' };
  const requests = [];
  const report = { checkedAt: '2026-11-09T15:00:00Z', capacity: { participant: 10, specialist: 3 }, note: 'Actual records', items: [] };
  const context = { document: { getElementById: get, createElement: () => new Element(), addEventListener() {}, hidden: false },
    FormData: class { get(key) { return fields[key]; } }, Intl, Date, Error, setInterval() {},
    fetch: async (url, options) => { const body = options?.body ? JSON.parse(options.body) : null; requests.push(body); return fetcher ? fetcher(body, report) : { ok: true, json: async () => report }; } };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { get, fields, requests, submit: () => get('pilot-form').events.submit({ preventDefault() {} }) };
}
const preview = body => ({ grant: { ...body, credits: 60 }, account: { email: body.email, freeSessionAvailable: true }, expectedRevision: 'preview-revision', canApplyNow: true, note: 'Complimentary credits' });

test('UI requires account confirmation and sends the exact preview revision when applying', async () => {
  const h = await fixture(async (body, report) => ({ ok: true, json: async () => body ? body.dryRun ? preview(body) : { applied: true, duplicate: false } : report }));
  await h.submit(); assert.match(h.get('pilot-preview').text(), /does not impose a hard total cap/);
  const before = h.requests.length; await h.get('pilot-apply').events.click(); assert.equal(h.requests.length, before);
  h.get('pilot-confirm').checked = true; await h.get('pilot-apply').events.click();
  const applied = h.requests.find(body => body?.dryRun === false);
  assert.equal(applied.expectedRevision, 'preview-revision'); assert.equal(applied.confirmAccountOwner, true);
  assert.match(h.get('pilot-status').textContent, /60 complimentary credits granted/);
});

test('editing the account invalidates an in flight preview and clears identity confirmation', async () => {
  let resolve;
  const h = await fixture(async (body, report) => body ? new Promise(done => { resolve = () => done({ ok: true, json: async () => preview(body) }); }) : { ok: true, json: async () => report });
  const pending = h.submit(); h.get('pilot-confirm').checked = true;
  h.fields.email = 'different@example.test'; h.get('pilot-form').events.input();
  resolve(); await pending;
  assert.equal(h.get('pilot-apply').disabled, true); assert.equal(h.get('pilot-confirm').checked, false);
  assert.equal(h.get('pilot-preview').text(), '');
});

test('unavailable reads do not become zero activity and account text is never HTML', async () => {
  const h = await fixture(async () => ({ ok: false, json: async () => ({ error: 'Database unavailable' }) }));
  assert.match(h.get('pilot-summary').textContent, /unavailable/);
  assert.match(h.get('pilot-accounts').text(), /No zero usage/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
});
