import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = { window: {} };
vm.runInNewContext(readFileSync(new URL('../js/partner-kit-model.js', import.meta.url), 'utf8'), context);
const { interviewSummary, moveoutSummary } = context.window.JHAKitModel;
test('blank planner is incomplete and does not invent experience', () => {
  const r = interviewSummary({}); assert.equal(r.complete,0); assert.match(r.text,/Not added yet/); assert.doesNotMatch(r.text,/led|improved|achieved/);
});
test('planner organises supplied facts and preserves limited ownership', () => {
  const r = interviewSummary({project:'Reporting',result:'Weekly report delivered',ownership:'I supported the team',action1:'Checked source totals',boundary:'The lead chose the architecture',reflection:'Confirm definitions earlier'});
  assert.equal(r.complete,3); assert.match(r.text,/My role: I supported the team/); assert.match(r.text,/1\. Checked source totals/); assert.doesNotMatch(r.text,/I led|2\./);
});
test('incomplete planner never labels missing responsibility complete', () => {
  const r=interviewSummary({project:'Reporting',result:'Delivered',action1:'QA',reflection:'Start earlier'}); assert.equal(r.complete,2);
});
test('comparison defaults every unknown confirmation to not confirmed', () => {
  const r=moveoutSummary({}); assert.match(r.status,/0 of 5 checks confirmed/); assert.equal(r.rows[0][1],'Not provided'); assert.equal(r.rows[1][2],'Not confirmed'); assert.doesNotMatch(r.text,/best|winner|recommended/);
});
test('zero is a real quote, empty or invalid amounts are not converted to zero', () => {
  const r=moveoutSummary({a:{price:'0'},b:{price:''}});assert.equal(r.rows[0][1],'$0.00');assert.equal(r.rows[0][2],'Not provided');
  assert.equal(moveoutSummary({a:{price:'-5'}}).rows[0][1],'Check the amount');
  assert.equal(moveoutSummary({a:{price:'NaN'}}).rows[0][1],'Check the amount');
});
test('different scopes remain visible without recommending the cheaper quote', () => {
  const r=moveoutSummary({a:{name:'A',price:'75',disposal:'no'},b:{name:'B',price:'120',disposal:'yes',written:'yes'}});
  assert.deepEqual(Array.from(r.rows[4]),['Disposal included','No','Confirmed']);assert.match(r.status,/Provider B: 2 of 5/);assert.match(r.text,/Quote amounts may cover different work/);assert.doesNotMatch(r.text,/choose A|save \$|cheapest/i);
});
test('private unusual text remains literal summary content', () => {
  const unsafe='<img src=x onerror=alert(1)>';
  assert.match(interviewSummary({action1:unsafe}).text,/<img src=x onerror=alert\(1\)>/);
  assert.equal(moveoutSummary({a:{name:unsafe}}).names[0],unsafe);
});
