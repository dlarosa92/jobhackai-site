import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../directory/directory.js', import.meta.url), 'utf8');

test('directory filters across every page and resets to the first page', () => {
  const cards = Array.from({length: 55}, (_, index) => ({
    dataset: {region: index < 53 ? 'Cincinnati' : 'Southeast Indiana'}, hidden: false
  }));
  const events = {};
  const button = () => ({disabled: false, addEventListener(type, handler) { this[type] = handler; }});
  const previous = button();
  const next = button();
  const status = {textContent: ''};
  const pagination = {
    hidden: true,
    querySelector(selector) {
      return {'[data-page="previous"]': previous, '[data-page="next"]': next, '[data-page-status]': status}[selector];
    }
  };
  const filterValues = new Map([['region', '']]);
  const filters = {values: filterValues, addEventListener(type, handler) { events[type] = handler; }};
  const count = {textContent: ''};
  const empty = {hidden: true};
  const elements = {'filters': filters, 'directory-pagination': pagination, 'result-count': count, 'no-results': empty};
  const document = {
    body: {dataset: {providerNoun: 'provider'}}, visibilityState: 'hidden',
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(selector) { return selector === '.listing' ? cards : []; },
    addEventListener() {}
  };
  const context = {document, window: {addEventListener() {}},
    FormData: class {constructor(form) {this.values = form.values;} keys() {return this.values.keys();} get(key) {return this.values.get(key);} [Symbol.iterator]() {return this.values[Symbol.iterator]();} },
    setTimeout(handler) { handler(); }, Set, Array, Object};
  vm.runInNewContext(source, context);
  assert.equal(cards.filter(card => !card.hidden).length, 24);
  assert.equal(status.textContent, 'Page 1 of 3');
  next.click();
  assert.equal(cards.filter(card => !card.hidden).length, 24);
  assert.equal(status.textContent, 'Page 2 of 3');
  filters.values.set('region', 'Southeast Indiana');
  events.change();
  assert.equal(cards.filter(card => !card.hidden).length, 2);
  assert.equal(count.textContent, '2 providers · alphabetical order');
  assert.equal(pagination.hidden, true);
  assert.equal(empty.hidden, true);
  filters.values.set('region', 'Northern Kentucky');
  events.change();
  assert.equal(cards.filter(card => !card.hidden).length, 0);
  assert.equal(empty.hidden, false);
  filters.values.set('region', '');
  events.reset();
  assert.equal(cards.filter(card => !card.hidden).length, 24);
  assert.equal(status.textContent, 'Page 1 of 3');
  assert.equal(previous.disabled, true);
});
