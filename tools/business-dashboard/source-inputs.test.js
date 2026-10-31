import test from 'node:test';
import assert from 'node:assert/strict';
import {captureInputs,candidateIdentity} from './scripts/capture-source-inputs.mjs';
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

for(let round=1;round<=3;round++)test(`candidate identity replay ${round}: merged candidate differs from head without a conflict`,async()=>{
 const candidate='c'.repeat(40),head='b'.repeat(40),pr={number:1089,html_url:'https://github.com/dlarosa92/jobhackai-site/pull/1089',state:'closed',merged_at:now,merge_commit_sha:candidate,head:{sha:head},base:{ref:'dev0'}};
 const identity=candidateIdentity(candidate,[pr]);assert.equal(identity.status,'verified');assert.equal(identity.matches[0].basis,'merged_commit');
 assert.equal(candidateIdentity(head,[pr]).matches[0].basis,'head');
 assert.equal(candidateIdentity(candidate,[{...pr,merged_at:null}]).status,'incomplete','Unmerged synthetic merge SHA does not prove a completed merge');
 assert.equal(candidateIdentity('d'.repeat(40),[pr]).status,'incomplete');
 const calls=[];
 const r=await captureInputs(async(k,p)=>{calls.push(p);if(p==='/api/work-items')return{...(await read(k,p)),items:[{id:'voice',source:'github',department:'product',boardLane:'in_progress',candidate},{id:'finished',source:'github',department:'product',boardLane:'completed',candidate:'e'.repeat(40)}]};if(p===`commits/${candidate}/pulls?per_page=100`)return [pr];return read(k,p);},()=>now);
 assert.equal(r.github.status,'current');assert.equal(r.github.candidateChecks[0].matches[0].mergeCommit,candidate);assert.equal(r.github.candidateChecks[0].observedAt,now);
 assert.deepEqual(r.board.productReferences.map(i=>i.id),['voice']);assert.equal(calls.filter(p=>p.startsWith('commits/')).length,1,'Completed releases do not trigger obsolete candidate lookups');
});
test('failed candidate lookup cannot be replaced by the dashboard receipt claim',async()=>{
 const candidate='c'.repeat(40);
 const r=await captureInputs(async(k,p)=>{if(p==='/api/work-items')return{...(await read(k,p)),items:[{id:'voice',source:'github',department:'product',boardLane:'in_progress',candidate}]};if(p.startsWith('commits/'))throw Error('private details');return read(k,p);},()=>now);
 assert.equal(r.github.status,'incomplete');assert.equal(r.github.candidateChecks[0].status,'incomplete');assert.equal(r.requests.filter(x=>x.error).length,1);assert.ok(!JSON.stringify(r).includes('private details'));
 const missingBoard=await captureInputs((k,p)=>p==='/api/work-items'?Promise.reject(Error('unavailable')):read(k,p),()=>now);
 assert.equal(missingBoard.github.status,'incomplete','Without the current board, the helper cannot establish which candidates need checking');
});
