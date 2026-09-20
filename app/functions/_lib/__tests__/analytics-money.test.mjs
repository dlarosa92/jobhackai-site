import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsMoney} from '../analytics-money.js';
const charge={amount_captured:3900,currency:'usd'};
const checkout={mode:'payment',amount_total:3900,currency:'usd',total_details:{amount_shipping:0,amount_tax:300}};
const invoice={status:'paid',amount_paid:3900,amount_remaining:0,shipping_cost:null,total:3900,total_excluding_tax:3600,currency:'usd'};
test('digital checkout and subscription preserve actual discounted payment excluding tax',()=>{
  for(const [input,item] of [[{checkout},'jobhackai_one_time'],[{invoice},'jobhackai_subscription']])
    assert.deepEqual(analyticsMoney(charge,input),{captured:3900,value:3600,tax:300,currency:'usd',item});
});
test('partial captures, unsupported shipping, missing breakdown and currency mismatch never guess revenue',()=>{
  for(const update of [{amount_total:7800},{currency:'cad'},{total_details:undefined},{total_details:{amount_shipping:100,amount_tax:0}},
    {total_details:{amount_shipping:0,amount_tax:-100}},{total_details:{amount_shipping:0,amount_tax:4000}}])
    assert.equal(analyticsMoney(charge,{checkout:{...checkout,...update}}),null);
});
test('customer balance, invoice underpayment, unknown shipping and unpaid invoices need reconciliation',()=>{
  for(const update of [{amount_paid:0},{amount_remaining:100},{total:4000},{total_excluding_tax:null},{shipping_cost:undefined},{shipping_cost:{}},{status:'open'}])
    assert.equal(analyticsMoney(charge,{invoice:{...invoice,...update}}),null);
});
test('zero-dollar and nonintegral captures do not produce monetary events',()=>{
  for(const value of [0,-1,39.1,NaN,undefined])assert.equal(analyticsMoney({...charge,amount_captured:value},{checkout}),null);
});
