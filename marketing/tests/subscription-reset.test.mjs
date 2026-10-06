import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../js/subscription-reset.js', import.meta.url), 'utf8');

function load({ now = '2026-10-05T12:00:00Z', zone = 'America/New_York', unavailable = false } = {}) {
  const label = { textContent: 'The next reset is at midnight UTC on the first of the month.' };
  const timers = new Map();
  let timerId = 0;
  let currentTime = now;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [currentTime])); }
  }
  runInNewContext(source, {
    Date: ClockDate,
    Intl: { DateTimeFormat: function (_, options) {
      if (unavailable) throw new Error('Formatting unavailable');
      return new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone });
    } },
    document: { getElementById: () => label, addEventListener() {} },
    window: {
      addEventListener() {},
      clearTimeout(id) { timers.delete(id); },
      setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; }
    }
  });
  return { label, timers, advance(time) { currentTime = time; } };
}

for (const [now, zone, expected] of [
  ['2026-10-05T12:00:00Z', 'America/New_York', 'October 31, 2026 at 8:00 PM EDT'],
  ['2026-11-05T12:00:00Z', 'America/New_York', 'November 30, 2026 at 7:00 PM EST'],
  ['2026-10-05T12:00:00Z', 'Asia/Kolkata', 'November 1, 2026 at 5:30 AM GMT+5:30'],
  ['2026-10-05T12:00:00Z', 'Asia/Tokyo', 'November 1, 2026 at 9:00 AM GMT+9'],
  ['2026-12-31T23:59:59Z', 'UTC', 'January 1, 2027 at 12:00 AM UTC']
]) {
  test(`renders the UTC reset locally: ${zone} on ${now}`, () => {
    assert.equal(load({ now, zone }).label.textContent, `Next reset: ${expected} (your local time).`);
  });
}

test('a continuously visible page advances its next reset across the month boundary', () => {
  const page = load({ now: '2026-12-31T23:59:59Z', zone: 'UTC' });
  const scheduled = [...page.timers.values()][0];
  assert.ok(scheduled.delay > 0 && scheduled.delay <= 2000);
  page.advance('2027-01-01T00:00:01Z');
  scheduled.callback();
  assert.equal(page.label.textContent, 'Next reset: February 1, 2027 at 12:00 AM UTC (your local time).');
  assert.equal(page.timers.size, 1);
  assert.ok([...page.timers.values()][0].delay <= 86400000);
});

test('far-off resets use a bounded timer instead of an overflowing browser timeout', () => {
  const page = load();
  assert.equal([...page.timers.values()][0].delay, 86400000);
});

test('unavailable local formatting preserves the UTC explanation', () => {
  assert.equal(load({ unavailable: true }).label.textContent, 'The next reset is at midnight UTC on the first of the month.');
});

test('pages without a reset label require no timers or listeners', () => {
  runInNewContext(source, { document: { getElementById: () => null } });
});
