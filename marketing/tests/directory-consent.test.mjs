import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../directory/directory.js', import.meta.url), 'utf8');
function setup({ consent = false, visible = true, listing = 'pearls', owner = true } = {}) {
  const calls = [], windowListeners = {}, documentListeners = {};
  const document = {
    visibilityState: visible ? 'visible' : 'hidden', body: { dataset: { listing } },
    getElementById: () => null,
    addEventListener(name, fn) { documentListeners[name] = fn; }
  };
  const window = {
    JHA: owner ? { cookieConsent: { hasAnalyticsConsent: () => consent }, gtagSafe: (...args) => calls.push(args) } : undefined,
    addEventListener(name, fn) { windowListeners[name] = fn; }
  };
  vm.runInNewContext(source, { window, document });
  return { calls,
    consent(value) { consent = value; windowListeners['cookie-consent-granted'](); },
    visible(value) { document.visibilityState = value ? 'visible' : 'hidden'; documentListeners.visibilitychange(); },
    click(dataset) { documentListeners.click({ target: { closest: () => ({ dataset }) } }); }
  };
}
test('unconsented interactions are dropped, not replayed after acceptance', () => {
  const h = setup();
  h.click({ directoryContact: 'pearls' }); h.click({ directoryInterest: 'listing' });
  assert.equal(h.calls.length, 0);
  h.consent(true);
  assert.deepEqual(h.calls.map(call => call[1]), ['directory_listing_view']);
  h.click({ directoryContact: 'pearls' });
  assert.equal(h.calls[1][1], 'directory_contact_click');
  assert.equal(h.calls[1][2].contact_method, 'provider_website');
  assert.equal(h.calls[1][2].business_line, 'local_directory');
});
test('a hidden listing waits for visibility and a consent cycle cannot double count it', () => {
  const h = setup({ consent: true, visible: false });
  assert.equal(h.calls.length, 0); h.visible(true); assert.equal(h.calls.length, 1);
  h.consent(false); h.click({ directoryContact: 'pearls' });
  h.visible(false); h.visible(true); assert.equal(h.calls.length, 1);
  h.consent(true); assert.equal(h.calls.length, 1);
  h.click({ directoryInterest: 'correction' });
  assert.equal(h.calls[1][1], 'directory_interest_click');
  assert.equal(h.calls[1][2].interest_type, 'correction');
  assert.equal(h.calls[1][2].contact_method, 'email');
  assert.ok(h.calls.every(call => !/lead|purchase|submitted/.test(call[1])));
});
test('no consent owner or a directory hub never manufactures a listing view', () => {
  const absent = setup({ owner: false, consent: true });
  absent.click({ directoryInterest: 'listing' }); absent.visible(true); absent.consent(true);
  assert.equal(absent.calls.length, 0);
  const hub = setup({ listing: '', consent: true });
  hub.visible(true); hub.consent(true); assert.equal(hub.calls.length, 0);
});
