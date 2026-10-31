#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';

const stage=process.argv[2];
if(!['dev','qa'].includes(stage))throw Error('Synthetic acceptance is restricted to isolated dev or QA. Production is forbidden.');
const origin=`https://dashboard-${stage}.jobhackai.io`;
const credential=JSON.parse(await readFile(resolve(homedir(),'.local/share/jobhackai/dashboard-access/credentials.json'),'utf8'));
const headers={'CF-Access-Client-Id':credential.clientId,'CF-Access-Client-Secret':credential.clientSecret,'Content-Type':'application/json'};
async function call(path,payload,status=200){
 const response=await fetch(origin+path,{method:payload?'POST':'GET',headers,body:payload?JSON.stringify(payload):undefined,redirect:'manual',signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,status,`${path}: expected HTTP ${status}, got ${response.status}`);
 return response.json();
}
const item=id=>call(`/api/work-items/${id}`);
const document={title:'Synthetic dashboard acceptance',department:'product',product:'core',preparation:'in_progress',channel:'QA fixture',contributors:[],expectedValue:'Verify dashboard integrity',effort:'Small',dependencies:[],nextAction:'Complete synthetic acceptance',completionCriteria:'All assertions pass',reason:'Isolated test data, no external actions',impact:'growth',sourceRefs:[{id:'fixture',url:'https://example.com/isolated-test'}],blocker:''};
const receipt=(id,step,version)=>({id,expectedVersion:version,eventId:`${id}-${step}`,candidate:'synthetic-accepted-candidate',stage:step,evidenceUrl:'https://example.com/isolated-test',summary:`Synthetic verified ${step}`,occurredAt:new Date().toISOString()});
assert.equal((await call('/api/session')).role,'machine');
const unauthenticated=await fetch(origin+'/api/work-items',{redirect:'manual'});
assert.notEqual(unauthenticated.status,200,'Anonymous access must not expose the dashboard');
const started=new Date().toISOString(),prefix=`acceptance-${Date.now()}`;
const results=[];
for(let round=1;round<=3;round++){
 const release=`${prefix}-release-${round}`;
 await call('/api/work-items/prepare',{id:release,source:'github',sourceId:release,expectedVersion:0,document});
 await call('/api/work-items/receipt',receipt(release,'production_verified',1),409);
 for(const step of ['dev_deployed','dev_verified','qa_deployed','qa_verified','production_deployed','production_verified']){
  let current=await item(release);const event=receipt(release,step,current.version);
  await call('/api/work-items/receipt',event);await call('/api/work-items/receipt',event);
  current=await item(release);
  await call('/api/work-items/prepare',{id:release,source:'github',sourceId:release,expectedVersion:current.version,document:{...document,reason:'Old PR is open',nextAction:'Start again',preparation:'ready'}});
  current=await item(release);
  await call('/api/work-items/reconcile',{id:release,expectedVersion:current.version,nativeState:'draft',sourceRevision:'old-pr',checkedAt:new Date().toISOString()},409);
  current=await item(release);assert.equal(current.receipts.at(-1).stage,step);assert.equal(current.detail,`Synthetic verified ${step}`);
  assert.equal(current.boardLane==='completed',step==='production_verified');
 }
 const post=`${prefix}-post-${round}`;
 await call('/api/work-items/prepare',{id:post,source:'meta',sourceId:post,expectedVersion:0,document:{...document,department:'marketing'}});
 await call('/api/work-items/feedback',{id:post,action:'approve'},403);
 const before=(await call('/api/work-items/changes')).revision;
 const event=receipt(post,'published',1),sentAt=performance.now();
 await call('/api/work-items/receipt',event);
 const visible=await item(post),latencyMs=Math.round(performance.now()-sentAt);
 assert.equal(visible.boardLane,'completed');assert.equal(visible.state,'published');
 assert.ok((await call('/api/work-items/changes')).revision>before);
 await call('/api/work-items/receipt',event);
 await call('/api/work-items/receipt',{...event,summary:'Conflicting result'},409);
 await call('/api/work-items/prepare',{id:post,source:'meta',sourceId:post,expectedVersion:visible.version,document:{...document,preparation:'ready'}});
 assert.equal((await item(post)).boardLane,'completed');
 results.push({round,release,post,publicationReceiptAndReadbackMs:latencyMs,result:'passed'});
 console.log(JSON.stringify(results.at(-1)));
}
console.log(JSON.stringify({stage,origin,started,finished:new Date().toISOString(),results,externalActions:0,productionWrites:0}));
