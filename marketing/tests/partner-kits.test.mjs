import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';
import { partnerKitLinks } from '../scripts/partner-kit-links.mjs';
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const script = read('../js/partner-kits.js');
function runtime({ consent = false, clipboardFails = false, kit = 'interview' } = {}) {
  const events = [], listeners = {}, status = { textContent: '' };
  const block = { textContent: 'A useful email. https://jobhackai.io/interview-prep-kit?utm_source=email' };
  const notes = { tagName: 'TEXTAREA', style: {}, scrollHeight: 200, value: 'PRIVATE NOTE NOT FOR ANALYTICS', addEventListener: (name, fn) => { if (name === 'input') listeners.note = fn; } };
  let copied = null, printed = 0;
  const context = { document: { body: { dataset: { kit } }, querySelectorAll: () => [notes], querySelector: selector => {
    if (selector === '[data-copy-status]') return status;
    if (selector === '[data-partner-block]') return block;
    return { addEventListener: (_, fn) => { listeners[selector] = fn; } };
  } }, navigator: { clipboard: { writeText: async text => { if (clipboardFails) throw new Error('blocked'); copied = text; } } },
  window: { location: { pathname: '/interview-prep-kit' }, print: () => printed++, JHA: { cookieConsent: { hasAnalyticsConsent: () => consent }, trackEventSafe: (...args) => events.push(args) } } };
  vm.runInNewContext(script, context);
  return { events, listeners, status, notes, copied: () => copied, printed: () => printed };
}
test('copy works without analytics consent and sends no events or notes', async () => {
  const r = runtime(); await r.listeners['[data-copy-block]']();
  assert.match(r.copied(), /A useful email/); assert.equal(r.events.length, 0);
  r.listeners.note(); assert.equal(r.notes.style.height, '204px'); assert.equal(r.events.length, 0);
});
test('granted analytics records successful copy and print intent, never worksheet contents', async () => {
  const r = runtime({ consent: true, kit: 'moveout' });
  await r.listeners['[data-copy-block]'](); r.listeners['[data-print-kit]']();
  assert.equal(r.printed(), 1); assert.equal(r.events.length, 2);
  assert.equal(r.events[0][1].business_line, 'local_directory');
  assert.deepEqual(r.events.map(e => e[1].action), ['email_block_copied', 'print_opened']);
  assert.doesNotMatch(JSON.stringify(r.events), /PRIVATE|value|NOTE/);
});
test('clipboard failure offers a manual fallback and never records a successful copy', async () => {
  const r = runtime({ consent: true, clipboardFails: true }); await r.listeners['[data-copy-block]']();
  assert.equal(r.copied(), null); assert.equal(r.events.length, 0); assert.match(r.status.textContent, /manually/);
});
test('partner links distinguish B2B review from end-user referrals without personal identifiers', () => {
  for (const [kit, id] of [['interview','recruiter_001'],['moveout','property_001']]) {
    const links = partnerKitLinks(kit,id);
    assert.equal(new URL(links.introduction).searchParams.get('utm_medium'), 'outreach');
    assert.equal(new URL(links.recipient_handoff).searchParams.get('utm_medium'), 'partner_referral');
    assert.equal(new Set([links.introduction,links.followup,links.recipient_handoff]).size, 3);
    assert.match(links.recipient_handoff, new RegExp(id+'_handoff_01'));
  }
  for (const id of ['a@b.com','Jane Smith','../../x','recruiter_001?email=x','property_001']) assert.throws(()=>partnerKitLinks('interview',id));
});
for (const [file,kit] of [['../interview-prep-kit.html','interview'],['../directory/move-out-kit.html','moveout']]) {
  test(`${kit} kit is accessible, consent-owned, and contains no acquisition-tagged internal navigation`, () => {
    const $ = load(read(file)); assert.equal($('main h1').length, 1);
    assert.equal($('script[src*="cookie-consent.js"]').length,1);
    assert.ok($('link[href*="cookie-consent.css"]').length);
    assert.ok($('[data-kit-notes]').length >= 7);
    $('[data-kit-notes]').each((_, el) => { assert.ok($(`label[for="${$(el).attr('id')}"]`).length); assert.equal($(el).attr('data-clarity-mask'),'true'); });
    $('a[href]').each((_, el) => { const url = new URL($(el).attr('href'),'https://jobhackai.io'); assert.equal(url.searchParams.has('utm_source'),false,'Only the copyable external handoff block carries campaign tags'); });
    assert.match($('[data-partner-block]').text(), /utm_medium=partner_referral/);
    assert.ok($('[data-copy-status][aria-live="polite"]').length);
    assert.equal($('[data-copy-block]').text(), 'Copy ready-to-paste text');
    assert.equal($('.paste-steps li').length, 3);
    assert.match($('a[href^="mailto:"]').attr('href'), /^mailto:support@jobhackai\.io\?subject=/);
    assert.ok($('[data-worksheet-preview][data-clarity-mask]').length);
    assert.equal($('script[src*="partner-kit-model.js"]').length,1);
  });
}
