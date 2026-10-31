import test from 'node:test';
import assert from 'node:assert/strict';
import {captureInputs} from './scripts/capture-source-inputs.mjs';
const now='2026-10-31T19:00:00.000Z';
const read=async(kind,path)=>{
  if(path==='/api/work-items')return {asOf:now,sources:[{source:'github',version:99,status:'current',detail:'Old PR claims'}],gmailSync:{lastSuccessfulSyncAt:now},directorySource:{status:'current',truncated:false},items:[]};
  if(path==='/api/analytics')return {status:'current',report:{checkedAt:now,events:[{name:'old',count:123}]}};
  if(path.startsWith('branches/'))return {name:path.split('/')[1],commit:{sha:'a'.repeat(40)}};
  return [{number:42,state:'closed',base:{ref:'dev0'},head:{sha:'b'.repeat(40)}}];
};
test('capture uses new API requests and excludes cached source claims and GA rows',async()=>{
 const calls=[];const r=await captureInputs(async(k,p)=>{calls.push([k,p]);return read(k,p);},()=>now);
 assert.equal(calls.length,6);assert.equal(r.github.status,'current');assert.equal(r.github.branches.main.observedAt,now);
 assert.deepEqual(r.board.sourceVersions,[{source:'github',version:99}]);assert.ok(!JSON.stringify(r).includes('Old PR claims'));assert.ok(!JSON.stringify(r).includes('123'));assert.equal(r.readOnly,true);
});
test('one failed GitHub request stays incomplete even when dashboard claims current',async()=>{
 const r=await captureInputs((k,p)=>p==='branches/main'?Promise.reject(Error('test')):read(k,p),()=>now);
 assert.equal(r.github.status,'incomplete');assert.equal(r.github.branches.main,undefined);assert.equal(r.requests.filter(x=>x.error).length,1);assert.ok(r.board);
});
test('malformed or missing sources never borrow stale values',async()=>{
 const r=await captureInputs((k,p)=>p==='/api/work-items'?Promise.reject(Error('private header')):p==='branches/main'?{}:read(k,p),()=>now);
 assert.equal(r.board,null);assert.equal(r.github.status,'incomplete');assert.ok(!JSON.stringify(r).includes('private header'));assert.ok(r.analytics);
});
