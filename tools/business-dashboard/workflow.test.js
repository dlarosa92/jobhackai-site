import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {workflowApi,workflowStatus,checkWorkflowDeadlines} from './src/workflow.js';
import {workApi,workRecords} from './src/work-items.js';
import {analyticsApi,analyticsReport,validateReport,previousDay} from './src/analytics.js';
import {allowed} from './src/access.js';
import worker from './worker.bundle.js';

const owner={role:'owner',id:'owner'},machine={role:'machine',id:'executor.access',capabilities:['read','prepare','reconcile','coordinate']};
const proof=[{url:'https://example.com/saved-draft',fact:'Complete saved draft independently read back.'}];
function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const db={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return {meta:{changes:sql.prepare(query).run(...this.args).changes}};},query};},async batch(statements){sql.exec('BEGIN');try{const values=statements.map(s=>({meta:{changes:sql.prepare(s.query).run(...s.args).changes}}));sql.exec('COMMIT');return values;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  const env={DASHBOARD_DB:db},now=new Date();
  const request=(path,input)=>new Request(`https://dashboard.jobhackai.io${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const flow=async(path,input,identity=machine,time=now)=>{const response=await workflowApi(request(`/api/workflow/${path}`,input),env,identity,time,board);return {status:response.status,body:await response.json()};};
  const board=()=>workRecords(db,{items:[]},now);
  const work=async(path,input,identity=input.runId?machine:owner)=>{const response=await workApi(request(`/api/work-items/${path}`,input),env,identity,board);return {status:response.status,body:await response.json()};};
  return {sql,db,env,flow,work,board,now,request};
}
const doc={title:'Move-out worksheet post',department:'marketing',product:'local',preparation:'ready',channel:'Facebook',contributors:[],expectedValue:'Useful move-out comparison guidance',effort:'Small',dependencies:[],nextAction:'Review the exact copy',completionCriteria:'Complete verified packet',reason:'Existing campaign continuation',sourceRefs:[{id:'saved-post',url:'https://example.com/saved-draft'}]};
const snap=(now,revision='source-1')=>({complete:true,conflict:false,sourceRevision:revision,checkedAt:now.toISOString(),verifiedBy:'Independent check',text:`Exact full draft ${revision}`,html:'',destination:'JobHackAI Local Facebook',subject:'',timing:'Proposed Tuesday, pending release',media:[],links:['https://jobhackai.io/go/moveout-worksheet'],evidence:[{id:revision,...proof[0]}]});
async function prepare(c){
  assert.equal((await c.work('prepare',{id:'post',source:'marblism',sourceId:'post',expectedVersion:0,document:doc})).status,200);
  const packet=snap(c.now);assert.equal((await c.work('reconcile',{id:'post',expectedVersion:1,sourceRevision:packet.sourceRevision,checkedAt:packet.checkedAt,nativeState:'draft',snapshot:packet})).status,200);
  await c.work('source-health',{source:'marblism',expectedVersion:0,status:'current',checkedAt:c.now.toISOString(),evidenceUrl:proof[0].url,detail:'Read saved copy',maxAgeMinutes:120});
  return (await c.board()).items[0];
}
async function decision(c,action='approve',note='Short links only please'){
  const item=await prepare(c);const input={id:item.id,expectedVersion:item.version,revision:item.snapshotRevision,requestId:'owner-decision',action,note};
  assert.equal((await c.work('feedback',input)).status,200);return input;
}
test('an exact owner decision creates one durable follow-up and replaces stale review instructions',async()=>{
  const c=fixture(),input=await decision(c);assert.equal((await c.work('feedback',input)).status,200);
  const item=(await c.board()).items[0];assert.equal(item.state,'approved');assert.match(item.nextAction,/Short links only/);assert.doesNotMatch(item.nextAction,/Review the exact copy/);
  assert.equal(c.sql.prepare('SELECT count(*) n FROM work_handoffs').get().n,1);
  assert.equal(c.sql.prepare('SELECT count(*) n FROM work_decisions').get().n,1);
  const migration=readFileSync(new URL('./migrations/006-workflow-reliability.sql',import.meta.url),'utf8');c.sql.exec(migration);c.sql.exec(migration);
  assert.equal(c.sql.prepare('SELECT count(*) n FROM work_handoffs').get().n,1);
  const changed=(await c.board()).items[0];await c.work('feedback',{...input,expectedVersion:changed.version,requestId:'owner-decline',action:'decline',note:'Retire this proposal'});
  assert.equal((await c.board()).items[0].boardLane,'completed');assert.equal((await workflowStatus(c.db,c.now)).handoffs.length,0);
});
test('missing and no-tool runs cannot become healthy, and an independent deadline check records the failure',async()=>{
  const c=fixture();c.sql.exec("UPDATE workflow_policies SET created_at='2026-01-01T00:00:00.000Z'");
  let status=await checkWorkflowDeadlines(c.env,c.now);assert.equal(status.alerts.length,3);
  const run=(await c.flow('start',{workflow:'preparation'})).body;
  assert.equal((await c.flow('finish',{id:run.id,outcome:'checked',summary:'Nothing changed',evidence:proof})).status,400);
  assert.equal((await c.flow('finish',{id:run.id,outcome:'advanced',summary:'Finished work',evidence:proof})).status,400);
  const later=new Date(c.now.getTime()+61*60000);status=await checkWorkflowDeadlines(c.env,later);
  assert.equal(status.workflows.find(w=>w.id==='preparation').status,'stalled');
  const first=c.sql.prepare("SELECT first_seen_at FROM workflow_alerts WHERE id='workflow-preparation'").get().first_seen_at;
  await checkWorkflowDeadlines(c.env,new Date(later.getTime()+60000));
  assert.equal(c.sql.prepare("SELECT first_seen_at FROM workflow_alerts WHERE id='workflow-preparation'").get().first_seen_at,first);
  assert.equal((await c.flow('finish',{id:run.id,outcome:'failed',summary:'Late'},machine,later)).status,409);
});
test('fresh source checks do not disguise an untouched preparation backlog',async()=>{
  const c=fixture();await prepare(c);const run=(await c.flow('start',{workflow:'preparation'})).body;
  const next=new Date(c.now.getTime()+1000);await c.work('source-health',{runId:run.id,source:'marblism',expectedVersion:1,status:'current',checkedAt:next.toISOString(),evidenceUrl:proof[0].url,detail:'Native source re-read',maxAgeMinutes:120});
  assert.equal((await c.flow('finish',{id:run.id,outcome:'checked',summary:'Weekend email hold',evidence:proof},machine,next)).status,400);
  assert.equal((await c.flow('finish',{id:run.id,outcome:'blocked',summary:'Needs a short URL',blocker:'Product must deploy the verified redirect',evidence:proof},machine,next)).status,400);
  const done=await c.flow('finish',{id:run.id,outcome:'blocked',summary:'Draft cannot be finished yet',blocker:'Product must deploy the verified redirect',nextCheckAt:new Date(c.now.getTime()+3600000).toISOString(),evidence:proof},machine,next);
  assert.equal(done.status,200);assert.equal((await workflowStatus(c.db,next)).workflows.find(w=>w.id==='preparation').status,'blocked');
});
test('claims are exclusive and requested changes require a fresh complete revised snapshot',async()=>{
  const c=fixture();await decision(c,'changes','Use the verified short link');const run=(await c.flow('start',{workflow:'preparation'})).body;
  assert.equal((await c.flow('start',{workflow:'preparation'})).body.id,run.id);
  assert.equal((await c.flow('start',{workflow:'preparation'},{...machine,id:'another.access'})).status,409);
  let claim=await c.flow('handoff',{runId:run.id,decisionId:'owner-decision',expectedVersion:1,action:'claim'});assert.equal(claim.status,200);
  const complete={runId:run.id,decisionId:'owner-decision',expectedVersion:2,action:'complete',resolution:'revised',summary:'Saved and verified the new full packet',evidence:proof};
  assert.equal((await c.flow('handoff',complete)).status,400);
  const item=(await c.board()).items[0],next=snap(new Date(c.now.getTime()+1000),'source-2');
  await c.work('reconcile',{runId:run.id,id:item.id,expectedVersion:item.version,sourceRevision:next.sourceRevision,checkedAt:next.checkedAt,nativeState:'draft',snapshot:next});
  assert.equal((await c.board()).items[0].canApprove,false);
  assert.equal((await c.flow('handoff',complete)).status,200);
  assert.equal((await c.board()).items[0].canApprove,true);
  assert.equal(c.sql.prepare('SELECT count(*) n FROM work_decisions').get().n,1);
  const finished=await c.flow('finish',{id:run.id,outcome:'advanced',summary:'Revised packet ready for review',evidence:proof},machine,new Date(c.now.getTime()+2000));
  assert.equal(finished.status,200);assert.deepEqual(finished.body.advancedItems,['post']);
  assert.equal((await c.flow('finish',{id:run.id,outcome:'advanced',summary:'Repeat',evidence:proof})).status,409);
});
test('a blocked handoff needs a checkpoint and does not delay independent work',async()=>{
  const c=fixture();await decision(c);const run=(await c.flow('start',{workflow:'preparation'})).body;
  await c.flow('handoff',{runId:run.id,decisionId:'owner-decision',expectedVersion:1,action:'claim'});
  const input={runId:run.id,decisionId:'owner-decision',expectedVersion:2,action:'block',summary:'Awaiting current source',blocker:'Browser source unavailable',evidence:proof};
  assert.equal((await c.flow('handoff',input)).status,400);
  assert.equal((await c.flow('handoff',{...input,nextCheckAt:new Date(c.now.getTime()+3600000).toISOString()})).status,200);
  const item=(await c.board()).items[0];assert.equal(item.boardLane,'blocked');assert.match(item.nextAction,/Browser source unavailable/);
  assert.equal((await workflowStatus(c.db,new Date(c.now.getTime()+3600001))).handoffs[0].overdue,true);
});
test('workflow machine endpoints preserve all owner-only release and permission boundaries',async()=>{
  for(const path of ['/api/workflow/start','/api/workflow/finish','/api/workflow/handoff','/api/analytics'])assert.equal(allowed(machine,'POST',path),true);
  for(const path of ['/api/work-items/feedback','/api/outreach/send','/api/outreach/approve','/api/costs','/api/access'])assert.equal(allowed(machine,'POST',path),false);
  const c=fixture();assert.equal((await c.flow('start',{workflow:'preparation'},{role:'machine',id:'reader',capabilities:['read']})).status,403);
  const run=(await c.flow('start',{workflow:'reconciliation'})).body;
  assert.equal((await c.flow('handoff',{runId:run.id,decisionId:'anything',expectedVersion:1,action:'claim'})).status,403);
  const promises=[];await worker.scheduled({scheduledTime:c.now.getTime()},c.env,{waitUntil:p=>promises.push(p)});await Promise.all(promises);
  assert.equal(promises.length,1);
});
const report=(now)=>({property:'523348532',windowDays:28,startDate:'2026-09-27',endDate:'2026-10-24',checkedAt:now.toISOString(),sourceUrl:'https://analytics.google.com/analytics/web/#/a366252518p523348532/reports',events:[{name:'partner_kit_action',count:6,users:1}],campaigns:[],kitActions:[],coverage:{internalTrafficExcluded:false,attributionVerified:false,purchasesReconciled:false,campaignBreakdownComplete:false,kitActionBreakdownComplete:false},notes:'Observed production events; staff exclusion and campaign attribution remain unverified.'});
test('analytics rejects frozen dates, preserves unknown coverage, and ages independently of page refresh',async()=>{
  const c=fixture(),now=new Date('2026-10-25T14:00:00Z');
  assert.equal(previousDay(new Date('2026-11-01T03:30:00Z')),'2026-10-30');
  assert.throws(()=>validateReport({...report(now),startDate:'2026-10-07',endDate:'2026-10-13'},now),/current rolling window/);
  assert.throws(()=>validateReport({...report(now),coverage:{}},now),/coverage/);
  assert.equal((await analyticsApi(c.request('/api/analytics',report(now)),c.env,now)).status,200);
  let current=await analyticsReport(c.db,now);assert.equal(current.status,'current');assert.equal(current.report.coverage.attributionVerified,false);
  assert.equal((await analyticsApi(c.request('/api/analytics',{...report(now),events:[{name:'partner_kit_action',count:7,users:1}]}),c.env,now)).status,409);
  current=await analyticsReport(c.db,new Date('2026-10-26T14:00:00Z'));assert.equal(current.status,'stale');assert.equal(current.report.events[0].count,6);
});

test('overlapping workflows cannot borrow source checks, artifacts or coordination',async()=>{
  const c=fixture();
  const prep=(await c.flow('start',{workflow:'preparation'})).body;
  const recon=(await c.flow('start',{workflow:'reconciliation'})).body;
  const coord=(await c.flow('start',{workflow:'coordination'})).body;
  const assessment={runId:coord.id,id:'daily-own',cadence:'daily',period:coord.period,assessments:['marketing','sales','product'].map(department=>({department,summary:'Checked current department evidence'})),adjustments:'Retain actual priorities',evidence:[proof[0].url]};
  assert.equal((await c.work('coordination',assessment)).status,200);
  for(const run of [prep,recon]){
    const finished=await c.flow('finish',{id:run.id,outcome:'checked',summary:'Borrowed another workflow check',evidence:proof});
    assert.equal(finished.status,400);assert.match(finished.body.error,/owned by this run/);
  }
  assert.equal((await c.work('prepare',{runId:prep.id,id:'own-item',source:'operations',sourceId:'own-item',expectedVersion:0,document:{...doc,preparation:'complete'}})).status,200);
  const check={source:'operations',expectedVersion:0,status:'current',checkedAt:new Date().toISOString(),evidenceUrl:proof[0].url,detail:'Independent source check',maxAgeMinutes:120};
  assert.equal((await c.work('source-health',{...check,runId:recon.id},{...machine,id:'foreign.access'})).status,403);
  assert.equal(c.sql.prepare('SELECT COUNT(*) n FROM source_health').get().n,0);
  assert.equal((await c.work('source-health',{...check,runId:recon.id})).status,200);
  assert.equal((await c.flow('finish',{id:prep.id,outcome:'advanced',summary:'Changed own artifact but borrowed reconciliation check',evidence:proof})).status,400);
  assert.equal((await c.flow('finish',{id:recon.id,outcome:'advanced',summary:'Borrowed preparation artifact',evidence:proof})).status,400);
  assert.equal((await c.flow('finish',{id:recon.id,outcome:'checked',summary:'Own current source check',evidence:proof})).status,200);
  assert.equal((await c.flow('finish',{id:coord.id,outcome:'checked',summary:'Own completed daily review',evidence:proof})).status,200);
});
test('completed dependency chains do not hide eligible preparation work',async()=>{
  const c=fixture();
  await c.work('prepare',{id:'prerequisite',source:'operations',sourceId:'prerequisite',expectedVersion:0,document:{...doc,preparation:'complete'}});
  await c.work('prepare',{id:'middle',source:'operations',sourceId:'middle',expectedVersion:0,document:{...doc,preparation:'complete',dependencies:['prerequisite']}});
  await c.work('prepare',{id:'dependent',source:'marblism',sourceId:'dependent',expectedVersion:0,document:{...doc,dependencies:['middle']}});
  const run=(await c.flow('start',{workflow:'preparation'})).body;
  assert.equal((await c.work('source-health',{runId:run.id,source:'marblism',expectedVersion:0,status:'current',checkedAt:new Date().toISOString(),evidenceUrl:proof[0].url,detail:'Saved source checked',maxAgeMinutes:120})).status,200);
  assert.deepEqual((await c.board()).items.find(i=>i.id==='dependent').unfinishedDependencies,[]);
  const rejected=await c.flow('finish',{id:run.id,outcome:'checked',summary:'Freshness only despite eligible dependent',evidence:proof});
  assert.equal(rejected.status,400);assert.match(rejected.body.error,/Eligible preparation remains/);
  const item=(await c.board()).items.find(i=>i.id==='dependent');
  await c.work('prepare',{runId:run.id,id:item.id,source:item.source,sourceId:item.sourceId,expectedVersion:item.version,document:{...doc,dependencies:['middle'],preparation:'blocked',blocker:'Saved draft needs the verified media asset'}});
  assert.equal((await c.flow('finish',{id:run.id,outcome:'checked',summary:'Independent checks complete; remaining media blocker is recorded',evidence:proof})).status,200);
});
