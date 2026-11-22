import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../../js/allowance-reset.js', import.meta.url), 'utf8');
function harness(now = '2026-11-22T12:00:00Z', { loading = false, badIntl = false } = {}) {
  let clock = Date.parse(now);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const makeHint = () => {
    const time = { textContent: '', dateTime: '' };
    return { hidden: true, time, querySelector: () => time };
  };
  const hints = [makeHint()];
  const events = new Map();
  const timers = new Map();
  let id = 0;
  const document = {
    hidden: false, readyState: loading ? 'loading' : 'complete',
    querySelectorAll: () => hints,
    addEventListener(name, callback) { events.set(name, callback); }
  };
  const context = vm.createContext({
    document, Date: Clock,
    Intl: badIntl ? { DateTimeFormat() { throw Error('unavailable'); } } : Intl,
    setTimeout(callback, delay) { timers.set(++id, { callback, delay }); return id; },
    clearTimeout(timer) { timers.delete(timer); },
    addEventListener(name, callback) { events.set(name, callback); }
  });
  vm.runInContext(source, context);
  return { api: context.JobHackAIAllowanceReset, hints, makeHint, document, events, timers,
    setNow(value) { clock = Date.parse(value); } };
}

test('next reset follows UTC month boundaries, leap years and year rollover', () => {
  const { api } = harness();
  for (const [now, expected] of [
    ['2024-02-29T23:59:59.999Z', '2024-03-01T00:00:00.000Z'],
    ['2026-04-30T23:59:59.999Z', '2026-05-01T00:00:00.000Z'],
    ['2026-12-31T23:59:59.999Z', '2027-01-01T00:00:00.000Z'],
    ['2027-01-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z']
  ]) assert.equal(api.nextReset(new Date(now)).toISOString(), expected);
});

test('western zones show the preceding local date and eastern zones the reset date', () => {
  const { api } = harness();
  const reset = new Date('2026-12-01T00:00:00Z');
  assert.match(api.formatReset(reset, 'en-US', 'America/New_York'), /November 30 at 7:00 PM EST/);
  assert.match(api.formatReset(reset, 'en-US', 'America/Los_Angeles'), /November 30 at 4:00 PM PST/);
  assert.match(api.formatReset(reset, 'en-US', 'Asia/Kolkata'), /December 1 at 5:30 AM GMT\+5:30/);
  assert.match(api.formatReset(reset, 'en-US', 'Asia/Tokyo'), /December 1 at 9:00 AM GMT\+9/);
});

test('the reset date uses the timezone offset on that date across spring and fall DST', () => {
  const { api } = harness();
  for (const [reset, expected] of [
    ['2026-03-01T00:00:00Z', /February 28 at 7:00 PM EST/],
    ['2026-04-01T00:00:00Z', /March 31 at 8:00 PM EDT/],
    ['2026-11-01T00:00:00Z', /October 31 at 8:00 PM EDT/],
    ['2026-12-01T00:00:00Z', /November 30 at 7:00 PM EST/]
  ]) assert.match(api.formatReset(new Date(reset), 'en-US', 'America/New_York'), expected);
});

test('renders a semantic timestamp only after formatting and refreshes at the boundary', () => {
  const h = harness('2026-12-31T23:59:59.900Z');
  assert.equal(h.hints[0].hidden, false);
  assert.equal(h.hints[0].time.dateTime, '2027-01-01T00:00:00.000Z');
  assert.notEqual(h.hints[0].time.textContent, '');
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 150);
  h.setNow('2027-01-01T00:00:00.050Z');
  timer.callback();
  assert.equal(h.hints[0].time.dateTime, '2027-02-01T00:00:00.000Z');
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 86400000);
});

test('hidden pages stop the timer and refresh on return or restored history', () => {
  const h = harness();
  h.document.hidden = true;
  h.events.get('visibilitychange')();
  assert.equal(h.timers.size, 0);
  h.setNow('2026-12-01T01:00:00Z');
  h.document.hidden = false;
  h.events.get('visibilitychange')();
  assert.equal(h.hints[0].time.dateTime, '2027-01-01T00:00:00.000Z');
  h.setNow('2027-01-01T01:00:00Z');
  h.events.get('pageshow')();
  assert.equal(h.hints[0].time.dateTime, '2027-02-01T00:00:00.000Z');
  assert.equal(h.timers.size, 1);
});

test('waits for static markup and can refresh a later voice-limit banner', () => {
  const h = harness(undefined, { loading: true });
  assert.equal(h.hints[0].hidden, true);
  assert.equal(h.timers.size, 0);
  h.events.get('DOMContentLoaded')();
  assert.equal(h.hints[0].hidden, false);
  h.hints.push(h.makeHint());
  h.api.refresh();
  assert.equal(h.hints[1].hidden, false);
  assert.equal(h.hints[1].time.dateTime, h.hints[0].time.dateTime);
  assert.equal(h.timers.size, 1);
});

test('formatting failures preserve the hidden hint and static fallback', () => {
  const h = harness(undefined, { badIntl: true });
  assert.equal(h.hints[0].hidden, true);
  assert.equal(h.hints[0].time.textContent, '');
  assert.equal(h.timers.size, 0);
});

test('marketing deployable copy is identical to the shared helper', () => {
  assert.equal(readFileSync(new URL('../../../../marketing/js/allowance-reset.js', import.meta.url), 'utf8'), source);
});
