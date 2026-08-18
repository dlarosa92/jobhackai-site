// readSubscriptionPeriod — explicit single-item rule (R2-6): root fields,
// else exactly one (plan-mapped) item; ambiguity is an explicit error, never
// a silent min/earliest guess.
import assert from 'node:assert';
import { readSubscriptionPeriod } from '../stripe-identity.js';

const START = 1755000000; // epoch seconds
const END = 1757678400;
const startIso = new Date(START * 1000).toISOString();
const endIso = new Date(END * 1000).toISOString();
const mapPrices = (pid) => ({ price_essential: 'essential', price_pro: 'pro' })[pid] || null;

// Null / non-subscription input: no error, no dates.
assert.deepStrictEqual(readSubscriptionPeriod(null), { currentPeriodStart: null, currentPeriodEnd: null, error: null });
assert.deepStrictEqual(readSubscriptionPeriod(undefined), { currentPeriodStart: null, currentPeriodEnd: null, error: null });

// Pre-Basil root shape wins.
const rootShape = readSubscriptionPeriod({ id: 'sub_x', current_period_start: START, current_period_end: END, items: { data: [] } });
assert.strictEqual(rootShape.currentPeriodStart, startIso);
assert.strictEqual(rootShape.currentPeriodEnd, endIso);
assert.strictEqual(rootShape.error, null);

// Basil item shape: exactly one item → its period.
const oneItem = readSubscriptionPeriod({
  id: 'sub_x',
  items: { data: [{ price: { id: 'price_essential' }, current_period_start: START, current_period_end: END }] }
});
assert.strictEqual(oneItem.currentPeriodStart, startIso);
assert.strictEqual(oneItem.currentPeriodEnd, endIso);
assert.strictEqual(oneItem.error, null);

// Single item works with no priceToPlan supplied.
const oneItemNoMap = readSubscriptionPeriod({
  id: 'sub_x',
  items: { data: [{ price: { id: 'price_unknown' }, current_period_start: START, current_period_end: END }] }
});
assert.strictEqual(oneItemNoMap.error, null);
assert.strictEqual(oneItemNoMap.currentPeriodEnd, endIso);

// Multiple items, exactly one maps to a known plan → that item, not the earliest.
const EARLIER = START - 999999;
const multiOneMapped = readSubscriptionPeriod({
  id: 'sub_x',
  items: { data: [
    { price: { id: 'price_addon' }, current_period_start: EARLIER, current_period_end: EARLIER + 100 },
    { price: { id: 'price_pro' }, current_period_start: START, current_period_end: END }
  ] }
}, { priceToPlan: mapPrices });
assert.strictEqual(multiOneMapped.error, null);
assert.strictEqual(multiOneMapped.currentPeriodStart, startIso, 'must use the plan-mapped item, never the earliest');
assert.strictEqual(multiOneMapped.currentPeriodEnd, endIso);

// Multiple items, multiple plan-mapped → explicit ambiguity error, null dates.
const multiAmbiguous = readSubscriptionPeriod({
  id: 'sub_x',
  items: { data: [
    { price: { id: 'price_essential' }, current_period_start: EARLIER, current_period_end: EARLIER + 100 },
    { price: { id: 'price_pro' }, current_period_start: START, current_period_end: END }
  ] }
}, { priceToPlan: mapPrices });
assert.strictEqual(multiAmbiguous.error, 'ambiguous_subscription_items');
assert.strictEqual(multiAmbiguous.currentPeriodStart, null);
assert.strictEqual(multiAmbiguous.currentPeriodEnd, null);

// Multiple items, no priceToPlan → ambiguous (no basis to choose).
const multiNoMap = readSubscriptionPeriod({
  id: 'sub_x',
  items: { data: [
    { price: { id: 'a' }, current_period_start: START, current_period_end: END },
    { price: { id: 'b' }, current_period_start: START, current_period_end: END }
  ] }
});
assert.strictEqual(multiNoMap.error, 'ambiguous_subscription_items');

// No items and no root fields → missing_period_item.
const noItems = readSubscriptionPeriod({ id: 'sub_x', items: { data: [] } });
assert.strictEqual(noItems.error, 'missing_period_item');

// One item without period fields → missing_period_item.
const bareItem = readSubscriptionPeriod({ id: 'sub_x', items: { data: [{ price: { id: 'price_essential' } }] } });
assert.strictEqual(bareItem.error, 'missing_period_item');

// Invalid values (non-finite / zero) are not dates.
const junk = readSubscriptionPeriod({ id: 'sub_x', items: { data: [{ price: { id: 'p' }, current_period_start: 'NaN', current_period_end: 0 }] } });
assert.strictEqual(junk.error, 'missing_period_item');

console.log('subscription-period.test.mjs: all assertions passed');
