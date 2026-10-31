import {d1Run} from './test-support/d1-result.js';
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
  const db={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return d1Run(sql,query,this.args);},query};},async batch(statements){sql.exec('BEGIN');try{const values=statements.map(s=>d1Run(sql,s.query,s.args));sql.exec('COMMIT');return values;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  const env={DASHBOARD_DB:db},now=new Date();
  const request=(path,input)=>new Request(`https://dashboard.jobhackai.io${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const flow=async(path,input,identity=machine,time=now)=>{const response=await workflowApi(request(`/api/workflow/${path}`,input),env,identity,time,board);return {status:response.status,body:await response.json()};};
  const board=()=>workRecords(db,{items:[]},now);
  const work=async(path,input,identity=input.runId?machine:owner)=>{const response=await workApi(request(`/api/work-items/${path}`,input),env,identity,board);return {status:response.status,body:await response.json()};};
  return {sql,db,env,flow,work,board,now,request};
}
const requiredSources=['marblism','campaign','gmail','directory','github'];
test('later audit failures invalidate a completed run without rewriting its history, across three sources',async()=>{
  for(const source of ['marblism','campaign','github']){
    const c=fixture(),run=(await c.flow('start',{workflow:'reconciliation'})).body;
    await checkSources(c,run);
    const finished=await c.flow('finish',{id:run.id,outcome:'checked',summary:'All sources checked',evidence:proof});assert.equal(finished.status,200);
    const original=c.sql.prepare('SELECT * FROM workflow_runs WHERE id=?').get(run.id);
    const old=c.sql.prepare('SELECT * FROM source_health WHERE source=?').get(source),auditAt=new Date(Date.parse(old.checked_at)+1000).toISOString();
    assert.equal((await c.work('source-health',{source,expectedVersion:old.version,status:'incomplete',checkedAt:auditAt,evidenceUrl:proof[0].url,detail:'Independent audit found unverified source claims',maxAgeMinutes:45})).status,200);
    const state=await workflowStatus(c.db,new Date(auditAt)),flow=state.workflows.find(x=>x.id==='reconciliation');
    assert.equal(flow.status,'incomplete');assert.deepEqual(flow.disputedSources,[source]);assert.match(state.alerts.find(a=>a.id==='workflow-reconciliation').detail,/Later source checks invalidate/);
    assert.deepEqual(c.sql.prepare('SELECT * FROM workflow_runs WHERE id=?').get(run.id),original);
    assert.equal(c.sql.prepare('SELECT last_success_at FROM source_health WHERE source=?').get(source).last_success_at,old.last_success_at);
  }
});
async function checkSources(c,run,sources=requiredSources,status='current') {
  for(const source of sources){
    const old=c.sql.prepare('SELECT version,checked_at FROM source_health WHERE source=?').get(source);
    const checkedAt=new Date(Math.max(Date.now(),c.now.getTime()+1,Date.parse(old?.checked_at||0)+1)).toISOString();
    assert.equal((await c.work('source-health',{runId:run.id,source,expectedVersion:old?.version||0,status,checkedAt,evidenceUrl:proof[0].url,detail:'Native metadata observed for this source',maxAgeMinutes:45})).status,200);
  }
}
const doc={title:'Move-out worksheet post',department:'marketing',product:'local',preparation:'ready',channel:'Facebook',contributors:[],expectedValue:'Useful move-out comparison guidance',effort:'Small',dependencies:[],nextAction:'Review the exact copy',completionCriteria:'Complete verified packet',reason:'Existing campaign continuation',sourceRefs:[{id:'saved-post',url:'https://example.com/saved-draft'}]};
const snap=(now,revision='source-1')=>({complete:true,conflict:false,sourceRevision:revision,checkedAt:now.toISOString(),verifiedBy:'Independent check',text:`Exact full draft ${revision}`,html:'',destination:'JobHackAI Local Facebook',subject:'',timing:'Proposed Tuesday, pending release',media:[],links:['https://jobhackai.io/go/moveout-worksheet'],evidence:[{id:revision,...proof[0]}]});
async function prepare(c){
  assert.equal((await c.work('prepare',{id:'post',source:'marblism',sourceId:'post',expectedVersion:0,document:doc})).status,200);
  const packet=snap(c.now);assert.equal((await c.work('reconcile',{id:'post',expectedVersion:1,sourceRevision:packet.sourceRevision,checkedAt:packet.checkedAt,nativeState:'draft',snapshot:packet})).status,200);
  await c.work('source-health',{source:'marblism',expectedVersion:0,status:'current',checkedAt:c.now.toISOString(),evidenceUrl:proof[0].url,detail:'Read saved copy',maxAgeMinutes:120});
  return (await c.board()).items[0];
}
async function checkItem(c,run,id='post'){
  const item=(await c.board()).items.find(i=>i.id===id),checkedAt=new Date(c.now.getTime()+1000).toISOString();
  const snapshot={...snap(c.now),...item.snapshot,checkedAt};
  assert.equal((await c.work('reconcile',{runId:run.id,id,expectedVersion:item.version,sourceRevision:snapshot.sourceRevision,checkedAt,nativeState:'draft',snapshot})).status,200);
}
async function decision(c,action='approve',note='Short links only please'){
  const item=await prepare(c);const input={id:item.id,expectedVersion:item.version,revision:item.snapshotRevision,requestId:'owner-decision',action,note};
  assert.equal((await c.work('feedback',input)).status,200);return input;
}
test('half-hour reconciliation creates distinct runs, retries once and preserves other cadences across three boundaries',async()=>{
  for(const base of ['2026-10-31T10:00:00.000Z','2026-10-31T23:00:00.000Z','2026-11-01T05:00:00.000Z']){
    const c=fixture(),at=minutes=>new Date(Date.parse(base)+minutes*60000);
    const first=(await c.flow('start',{workflow:'reconciliation'},machine,at(1))).body;
    assert.equal(first.period,base.slice(0,16));
    assert.equal((await c.flow('start',{workflow:'reconciliation'},machine,at(29))).body.id,first.id);
    // Mark a legitimate checked result in the fixture, preserving its receipt for retry checks.
    c.sql.prepare("UPDATE workflow_runs SET status='checked',finished_at=?,result='{}' WHERE id=?").run(at(29).toISOString(),first.id);
    const second=(await c.flow('start',{workflow:'reconciliation'},machine,at(30))).body;
    assert.notEqual(second.id,first.id);assert.equal(second.period,at(30).toISOString().slice(0,16));
    assert.equal((await c.flow('start',{workflow:'reconciliation'},machine,at(59))).body.id,second.id);
    c.sql.prepare("UPDATE workflow_runs SET status='checked',finished_at=?,result='{}' WHERE id=?").run(at(59).toISOString(),second.id);
    const third=(await c.flow('start',{workflow:'reconciliation'},machine,at(60))).body;
    assert.notEqual(third.id,second.id);assert.equal(third.period,at(60).toISOString().slice(0,16));
    for(const workflow of ['preparation','coordination']){
      const before=(await c.flow('start',{workflow},machine,at(1))).body;
      assert.equal((await c.flow('start',{workflow},machine,at(30))).body.id,before.id);
    }
    assert.equal(c.sql.prepare("SELECT count(*) n FROM workflow_runs WHERE workflow='reconciliation'").get().n,3);
  }
});
test('half-hour reconciliation refuses overlapping leases and recovers after completion or expiry',async()=>{
  for(const ending of ['checked','failed','expired']){
    const c=fixture(),time=new Date('2026-10-31T10:01:00.000Z');
    const first=(await c.flow('start',{workflow:'reconciliation'},machine,time)).body;
    const next=new Date('2026-10-31T10:30:00.000Z');
    assert.equal((await c.flow('start',{workflow:'reconciliation'},machine,next)).status,409);
    if(ending!=='expired')c.sql.prepare('UPDATE workflow_runs SET status=? WHERE id=?').run(ending,first.id);
    else next.setTime(Date.parse('2026-10-31T11:01:00.000Z'));
    const started=await c.flow('start',{workflow:'reconciliation'},machine,next);
    assert.equal(started.status,200);assert.notEqual(started.body.id,first.id);
    assert.equal(c.sql.prepare("SELECT count(*) n FROM workflow_runs WHERE status='running' AND lease_until>?").get(next.toISOString()).n,1);
  }
});
test('half-hour reconciliation preserves legacy hourly receipts in their actual slots and rejects ownership changes',async()=>{
  for(const minute of ['01','31']){
    const c=fixture(),start=new Date(`2026-10-31T10:${minute}:00.000Z`);
    const first=(await c.flow('start',{workflow:'reconciliation'},machine,start)).body;
    c.sql.prepare("UPDATE workflow_runs SET period='2026-10-31T10',status='checked' WHERE id=?").run(first.id);
    const retry=await c.flow('start',{workflow:'reconciliation'},machine,start);
    assert.equal(retry.body.id,first.id);assert.equal(retry.body.reused,true);
    assert.equal((await c.flow('start',{workflow:'reconciliation'},{...machine,id:'different.access'},start)).status,409);
    const next=await c.flow('start',{workflow:'reconciliation'},machine,new Date(start.getTime()+30*60000));
    assert.equal(next.status,200);assert.notEqual(next.body.id,first.id);
    assert.equal(c.sql.prepare('SELECT period FROM workflow_runs WHERE id=?').get(first.id).period,'2026-10-31T10');
  }
});
test('half-hour reconciliation checks overlapping starts atomically after the baseline read',async()=>{
  const c=fixture(),time=new Date('2026-10-31T10:01:00.000Z');
  const first=(await c.flow('start',{workflow:'reconciliation'},machine,time)).body;
  // Both starts complete their asynchronous reads before either inserts.
  const timeAfterExpiry=new Date('2026-10-31T11:01:00.000Z');
  const results=await Promise.all([timeAfterExpiry,new Date('2026-10-31T11:30:00.000Z')].map(t=>c.flow('start',{workflow:'reconciliation'},machine,t)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(c.sql.prepare("SELECT count(*) n FROM workflow_runs WHERE id<>? AND status='running'").get(first.id).n,1);
});
test('half-hour reconciliation deadline migration is repeatable, retains history and alerts after 45 minutes',async()=>{
  const c=fixture(),time=new Date('2026-10-31T10:00:00.000Z');
  const run=(await c.flow('start',{workflow:'reconciliation'},machine,time)).body;
  c.sql.prepare("UPDATE workflow_runs SET status='checked',finished_at=?,result=? WHERE id=?").run(time.toISOString(),JSON.stringify({coverage:{verified:requiredSources}}),run.id);
  c.sql.exec("UPDATE workflow_policies SET max_age_minutes=90 WHERE id='reconciliation'");
  const before=c.sql.prepare('SELECT * FROM workflow_runs').all();
  const migration=readFileSync(new URL('./migrations/009-half-hour-reconciliation.sql',import.meta.url),'utf8');
  c.sql.exec(migration);c.sql.exec(migration);
  assert.deepEqual(c.sql.prepare('SELECT * FROM workflow_runs').all(),before);
  assert.equal(c.sql.prepare("SELECT max_age_minutes FROM workflow_policies WHERE id='preparation'").get().max_age_minutes,90);
  assert.equal(c.sql.prepare("SELECT max_age_minutes FROM workflow_policies WHERE id='coordination'").get().max_age_minutes,1560);
  assert.equal((await workflowStatus(c.db,new Date(time.getTime()+45*60000))).workflows.find(w=>w.id==='reconciliation').status,'current');
  assert.equal((await workflowStatus(c.db,new Date(time.getTime()+45*60000+1))).workflows.find(w=>w.id==='reconciliation').status,'missing');
});
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
  const c=fixture();await prepare(c);
  await c.work('prepare',{id:'unfinished',source:'marblism',sourceId:'unfinished',expectedVersion:0,document:{...doc,preparation:'in_progress',blocker:'Copy and timing still need checking'}});
  const run=(await c.flow('start',{workflow:'preparation'})).body;
  const next=new Date(c.now.getTime()+1000);await checkItem(c,run);
  assert.equal((await c.flow('finish',{id:run.id,outcome:'checked',summary:'Weekend email hold',evidence:proof},machine,next)).status,400);
  assert.equal((await c.flow('finish',{id:run.id,outcome:'blocked',summary:'Needs a short URL',blocker:'Product must deploy the verified redirect',evidence:proof},machine,next)).status,400);
  const held={id:run.id,outcome:'blocked',summary:'Draft cannot be finished yet',blocker:'Product must deploy the verified redirect',nextCheckAt:new Date(c.now.getTime()+3600000).toISOString(),evidence:proof};
  const rejected=await c.flow('finish',held,machine,next);assert.equal(rejected.status,400);assert.match(rejected.body.error,/unfinished/);
  await c.work('prepare',{runId:run.id,id:'unfinished',source:'marblism',sourceId:'unfinished',expectedVersion:1,document:{...doc,preparation:'blocked',blocker:'Required redirect deployment is held for a separate owner release.'}});
  const done=await c.flow('finish',held,machine,next);
  assert.equal(done.status,200);assert.equal((await workflowStatus(c.db,next)).workflows.find(w=>w.id==='preparation').status,'blocked');
});
test('a blocked classification without a reason remains unfinished preparation',async()=>{
  const c=fixture();await c.work('prepare',{id:'unexplained',source:'marblism',sourceId:'unexplained',expectedVersion:0,document:{...doc,preparation:'blocked'}});
  const response=await workflowApi(new Request('https://dashboard.jobhackai.io/api/workflow'),c.env,machine,c.now,c.board);
  assert.equal((await response.json()).preparationQueue.eligibleCount,1);
  const run=(await c.flow('start',{workflow:'preparation'})).body;
  const result=await c.flow('finish',{id:run.id,outcome:'blocked',summary:'Nothing to do',blocker:'Waiting for owner',nextCheckAt:new Date(c.now.getTime()+3600000).toISOString(),evidence:proof});
  assert.equal(result.status,400);assert.match(result.body.error,/unexplained/);
});
test('terminal native work cannot leave an invisible handoff blocking completion',async()=>{
  for(const nativeState of ['sent','published','closed','scheduled']){
    const c=fixture();await decision(c);const run=(await c.flow('start',{workflow:'preparation'})).body;
    const item=(await c.board()).items[0],next=new Date(c.now.getTime()+1000);
    assert.equal((await c.work('reconcile',{runId:run.id,id:item.id,expectedVersion:item.version,sourceRevision:item.snapshot.sourceRevision,checkedAt:next.toISOString(),nativeState,snapshot:{...item.snapshot,checkedAt:next.toISOString()}})).status,200);
    assert.equal((await workflowStatus(c.db,c.now)).handoffs.length,0);
    const finished=await c.flow('finish',{id:run.id,outcome:'checked',summary:'Native execution verified; no unfinished preparation',evidence:proof},machine,next);
    assert.equal(finished.status,200,nativeState);
    assert.equal(c.sql.prepare('SELECT count(*) n FROM work_handoffs').get().n,1);
  }
});
test('finished owner-review packets do not prevent a verified quiet check or hide independent work',async()=>{
  const c=fixture();await prepare(c);
  let response=await workflowApi(new Request('https://dashboard.jobhackai.io/api/workflow'),c.env,machine,c.now,c.board);
  let status=await response.json();assert.deepEqual(status.preparationQueue,{eligibleCount:0,items:[],awaitingOwner:['post']});
  const withNotifications=()=>workRecords(c.db,{items:[
    {id:'gmail-new',source:'gmail',title:'Unread reply',state:'pending'},
    {id:'directory-new',source:'directory',title:'New listing request',state:'pending'},
    {id:'outreach-draft',source:'outreach',outreachId:'draft',title:'Prepared email',state:'pending',deliveryState:'review',issues:[],approved:false},
    {id:'outreach-approved',source:'outreach',outreachId:'approved',title:'Approved email awaiting separate release',state:'approved',deliveryState:'review',issues:[],approved:true},
    {id:'outreach-held',source:'outreach',outreachId:'held',title:'Email with unresolved checks',state:'hold',deliveryState:'review',issues:['Verify current routing'],approved:false},
  ]},c.now);
  assert.equal((await withNotifications()).items.filter(i=>i.boardLane==='ready').length,5);
  response=await workflowApi(new Request('https://dashboard.jobhackai.io/api/workflow'),c.env,machine,c.now,withNotifications);
  assert.deepEqual((await response.json()).preparationQueue.awaitingOwner,['outreach-approved','outreach-draft','post']);
  const run=(await c.flow('start',{workflow:'preparation'})).body;
  const next=new Date(c.now.getTime()+1000);
  await checkItem(c,run);
  assert.equal((await c.flow('finish',{id:run.id,outcome:'checked',summary:'Finished packet awaits owner; no unfinished preparation',evidence:proof},machine,next)).status,200);
  await c.work('prepare',{id:'independent',source:'marblism',sourceId:'independent',expectedVersion:0,document:{...doc,preparation:'in_progress',nextAction:'Verify the saved source and prepare its packet'}});
  response=await workflowApi(new Request('https://dashboard.jobhackai.io/api/workflow'),c.env,machine,c.now,c.board);
  status=await response.json();assert.equal(status.preparationQueue.eligibleCount,1);assert.equal(status.preparationQueue.items[0].id,'independent');assert.deepEqual(status.preparationQueue.awaitingOwner,['post']);
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
  const held={id:run.id,outcome:'blocked',summary:'Waiting for owner',blocker:'Separate release is unavailable',nextCheckAt:new Date(c.now.getTime()+3600000).toISOString(),evidence:proof};
  assert.equal((await c.flow('finish',held)).status,400);
  await c.flow('handoff',{runId:run.id,decisionId:'owner-decision',expectedVersion:1,action:'claim'});
  const input={runId:run.id,decisionId:'owner-decision',expectedVersion:2,action:'block',summary:'Awaiting current source',blocker:'Browser source unavailable',evidence:proof};
  assert.equal((await c.flow('handoff',input)).status,400);
  assert.equal((await c.flow('handoff',{...input,nextCheckAt:new Date(c.now.getTime()+3600000).toISOString()})).status,200);
  assert.equal((await c.flow('finish',held)).status,200);
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
test('a later analytics audit marks saved figures unverified without deleting the report',async()=>{
  const c=fixture(),now=new Date('2026-10-25T12:00:00.000Z'),payload=report(now);
  c.sql.prepare('INSERT INTO analytics_reports(id,checked_at,payload) VALUES(?,?,?)').run('saved',now.toISOString(),JSON.stringify(payload));
  assert.equal((await analyticsReport(c.db,now)).status,'current');
  await c.work('source-health',{source:'analytics',expectedVersion:0,status:'incomplete',checkedAt:'2026-10-25T12:01:00.000Z',evidenceUrl:payload.sourceUrl,detail:'The Events table was not read',maxAgeMinutes:1440});
  const checked=await analyticsReport(c.db,new Date('2026-10-25T12:02:00.000Z'));
  assert.equal(checked.status,'incomplete');assert.deepEqual(checked.report,payload);assert.match(checked.detail,/not currently verified/);
  const updated={...payload,checkedAt:'2026-10-25T12:03:00.000Z'};
  c.sql.prepare('INSERT INTO analytics_reports(id,checked_at,payload) VALUES(?,?,?)').run('reread',updated.checkedAt,JSON.stringify(updated));
  assert.equal((await analyticsReport(c.db,new Date('2026-10-25T12:04:00.000Z'))).status,'current');
});
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
  await checkSources(c,recon);
  assert.equal((await c.flow('finish',{id:recon.id,outcome:'checked',summary:'Own current source checks',evidence:proof})).status,200);
  assert.equal((await c.flow('finish',{id:coord.id,outcome:'checked',summary:'Own completed daily review',evidence:proof})).status,200);
});
test('completed dependency chains do not hide eligible preparation work',async()=>{
  const c=fixture();
  await c.work('prepare',{id:'prerequisite',source:'operations',sourceId:'prerequisite',expectedVersion:0,document:{...doc,preparation:'complete'}});
  await c.work('prepare',{id:'middle',source:'operations',sourceId:'middle',expectedVersion:0,document:{...doc,preparation:'complete',dependencies:['prerequisite']}});
  await c.work('prepare',{id:'dependent',source:'marblism',sourceId:'dependent',expectedVersion:0,document:{...doc,dependencies:['middle']}});
  const run=(await c.flow('start',{workflow:'preparation'})).body;
  await checkItem(c,run,'dependent');
  assert.deepEqual((await c.board()).items.find(i=>i.id==='dependent').unfinishedDependencies,[]);
  const rejected=await c.flow('finish',{id:run.id,outcome:'checked',summary:'Freshness only despite eligible dependent',evidence:proof});
  assert.equal(rejected.status,400);assert.match(rejected.body.error,/Eligible preparation remains/);
  const item=(await c.board()).items.find(i=>i.id==='dependent');
  await c.work('prepare',{runId:run.id,id:item.id,source:item.source,sourceId:item.sourceId,expectedVersion:item.version,document:{...doc,dependencies:['middle'],preparation:'blocked',blocker:'Saved draft needs the verified media asset'}});
  assert.equal((await c.flow('finish',{id:run.id,outcome:'checked',summary:'Independent checks complete; remaining media blocker is recorded',evidence:proof})).status,200);
});

test('a later concurrent item write cannot contaminate the first mutation receipt',async()=>{
  const c=fixture(),initial={...doc,preparation:'in_progress'};
  await c.work('prepare',{id:'racing',source:'operations',sourceId:'racing',expectedVersion:0,document:initial});
  const run=(await c.flow('start',{workflow:'preparation'})).body;
  const original=c.db.prepare.bind(c.db);let reads=0;
  c.db.prepare=query=>{const statement=original(query);if(query==='SELECT * FROM work_items WHERE id=?'){
    const first=statement.first.bind(statement);statement.first=async()=>{
      if(++reads===3)c.sql.prepare('UPDATE work_items SET document=?,checked_at=?,version=version+1 WHERE id=?').run(JSON.stringify({...initial,title:'Another run changed this'}),new Date(c.now.getTime()+1000).toISOString(),'racing');
      return first();
    };
  }return statement;};
  const result=await c.work('prepare',{runId:run.id,id:'racing',source:'operations',sourceId:'racing',expectedVersion:1,document:initial});
  assert.equal(result.status,200);assert.equal(result.body.version,3,'Shared read observes the racing writer');
  const receipt=c.sql.prepare('SELECT version,result FROM workflow_run_writes WHERE run_id=?').get(run.id);
  assert.equal(receipt.version,2);assert.deepEqual(JSON.parse(receipt.result),{advanced:false,checked:false,progressBasis:'deliverable-v1'});
  assert.equal((await c.flow('finish',{id:run.id,outcome:'advanced',summary:'Must not borrow the later write',evidence:proof})).status,400);
});

test('wording and evidence-only edits cannot claim progress or reset work age',async()=>{
 const c=fixture();const item=await prepare(c);const run=(await c.flow('start',{workflow:'reconciliation'})).body;
 await c.work('prepare',{runId:run.id,id:item.id,source:item.source,sourceId:item.sourceId,expectedVersion:item.version,document:{...doc,nextAction:'Reworded instruction after another check'}});
 let current=(await c.board()).items[0];
 assert.equal(current.lastMovedAt,null);
 const original=snap(c.now),changed={...original,evidence:[{id:'another-proof',url:proof[0].url,fact:'Checked the same full draft again.'}],checkedAt:new Date(c.now.getTime()+1).toISOString()};
 assert.equal((await c.work('reconcile',{runId:run.id,id:current.id,expectedVersion:current.version,sourceRevision:changed.sourceRevision,checkedAt:changed.checkedAt,nativeState:'draft',snapshot:changed})).status,200);
 current=(await c.board()).items[0];assert.equal(current.lastMovedAt,null);
 assert.equal((await c.flow('finish',{id:run.id,outcome:'advanced',summary:'Only wording changed',evidence:proof})).status,400);
 const revised={...changed,text:'A genuinely changed complete draft.',checkedAt:new Date(c.now.getTime()+2).toISOString()};
 assert.equal((await c.work('reconcile',{runId:run.id,id:current.id,expectedVersion:current.version,sourceRevision:revised.sourceRevision,checkedAt:revised.checkedAt,nativeState:'draft',snapshot:revised})).status,200);
 current=(await c.board()).items[0];assert.ok(current.lastMovedAt);assert.ok((await c.board()).progress.trackedSince);
 await checkSources(c,run);
 const finished=await c.flow('finish',{id:run.id,outcome:'advanced',summary:'Revised draft saved',evidence:proof});assert.equal(finished.status,200);assert.deepEqual(finished.body.advancedItems,['post']);
});

for(let round=1;round<=3;round++)test(`receipt attribution survives a lost response without borrowing another run, round ${round}`,async()=>{
 const c=fixture();const item=await prepare(c);
 const run=(await c.flow('start',{workflow:'reconciliation'})).body;
 const other=(await c.flow('start',{workflow:'preparation'})).body;
 const event={id:item.id,eventId:`published-lost-response-${round}`,expectedVersion:item.version,candidate:'approved-post',stage:'published',evidenceUrl:proof[0].url,summary:'Native publication verified',occurredAt:new Date().toISOString(),runId:run.id};
 const batch=c.db.batch.bind(c.db);let interrupted=false;
 c.db.batch=async statements=>{const result=await batch(statements);if(!interrupted){interrupted=true;throw Error('Response lost after commit');}return result;};
 await assert.rejects(c.work('receipt',event),/Response lost after commit/);
 assert.equal(c.sql.prepare('SELECT count(*) n FROM work_receipts').get().n,1);
 assert.equal(c.sql.prepare('SELECT count(*) n FROM workflow_run_writes WHERE run_id=?').get(run.id).n,1,'Attribution committed with receipt before response');
 const retry=await c.work('receipt',event);assert.equal(retry.status,200);assert.equal(retry.body.replayed,true);
 assert.equal((await c.work('receipt',{...event,runId:other.id})).status,200);
 assert.equal(c.sql.prepare('SELECT count(*) n FROM workflow_run_writes WHERE run_id=?').get(other.id).n,0,'A different run cannot borrow the original result');
 assert.equal((await c.flow('finish',{id:other.id,outcome:'advanced',summary:'Borrowed result',evidence:proof})).status,400);
 await checkSources(c,run);
 assert.equal((await c.flow('finish',{id:run.id,outcome:'advanced',summary:'Verified publication with recovered response',evidence:proof})).status,200);
});

test('receipt and originating workflow attribution roll back together on attribution failure',async()=>{
 const c=fixture(),item=await prepare(c),run=(await c.flow('start',{workflow:'reconciliation'})).body;
 c.sql.exec("CREATE TRIGGER fail_attribution BEFORE INSERT ON workflow_run_writes BEGIN SELECT RAISE(ABORT,'injected write failure'); END;");
 await assert.rejects(c.work('receipt',{id:item.id,eventId:'atomic-failure',expectedVersion:item.version,candidate:'approved-post',stage:'published',evidenceUrl:proof[0].url,summary:'Native publication verified',occurredAt:new Date().toISOString(),runId:run.id}),/injected write failure/);
 assert.equal(c.sql.prepare('SELECT count(*) n FROM work_receipts').get().n,0);
 const after=(await c.board()).items[0];assert.equal(after.version,item.version);assert.equal(after.nativeState,'draft');
});

for(let round=1;round<=3;round++)test(`reconciliation rejects a GitHub-only pass and requires all native source observations, round ${round}`,async()=>{
  const c=fixture(),run=(await c.flow('start',{workflow:'reconciliation'})).body;
  await checkSources(c,run,['github']);
  const finish={id:run.id,outcome:'checked',summary:'Source metadata checked',evidence:proof};
  let result=await c.flow('finish',finish);
  assert.equal(result.status,400);assert.match(result.body.error,/Missing: marblism, campaign, gmail, directory/);
  assert.equal(c.sql.prepare('SELECT status FROM workflow_runs WHERE id=?').get(run.id).status,'running');
  await checkSources(c,run,['campaign','gmail','directory']);
  const prep=(await c.flow('start',{workflow:'preparation'})).body;
  assert.equal((await c.work('source-health',{runId:prep.id,source:'marblism',expectedVersion:0,status:'current',checkedAt:new Date().toISOString(),evidenceUrl:proof[0].url,detail:'Wrong workflow writer',maxAgeMinutes:45})).status,409);
  result=await c.flow('finish',finish);assert.equal(result.status,400);assert.match(result.body.error,/Missing: marblism/);
  await checkSources(c,run,['marblism']);
  result=await c.flow('finish',finish);assert.equal(result.status,200);assert.equal(result.body.coverage.complete,true);
  assert.deepEqual(result.body.coverage.verified,requiredSources);
  assert.deepEqual(result.body.coverage.missing,[]);assert.deepEqual(result.body.coverage.unsuccessful,[]);
  const readback=await workflowStatus(c.db,c.now);
  assert.equal(readback.workflows.find(w=>w.id==='reconciliation').status,'current');
});
test('failed or partial source reads preserve last success and cannot become a successful reconciliation',async()=>{
  for(const status of ['unavailable','incomplete']){
    const c=fixture(),run=(await c.flow('start',{workflow:'reconciliation'})).body;
    await checkSources(c,run);
    const successfulAt=c.sql.prepare("SELECT last_success_at FROM source_health WHERE source='marblism'").get().last_success_at;
    await checkSources(c,run,['marblism'],status);
    const result=await c.flow('finish',{id:run.id,outcome:'checked',summary:'Not actually complete',evidence:proof});
    assert.equal(result.status,400);assert.match(result.body.error,/Unsuccessful: marblism/);
    assert.equal(c.sql.prepare("SELECT last_success_at FROM source_health WHERE source='marblism'").get().last_success_at,successfulAt);
    const held=await c.flow('finish',{id:run.id,outcome:'blocked',summary:'Independent sources checked; Marblism unavailable',blocker:'Native Marblism access could not be verified',nextCheckAt:new Date(c.now.getTime()+1800000).toISOString(),evidence:proof});
    assert.equal(held.status,200);assert.equal(held.body.coverage.complete,false);
    assert.deepEqual(held.body.coverage.unsuccessful,['marblism']);assert.ok(!held.body.checkedSources.includes('marblism'));
  }
});
test('reusing an old source timestamp does not verify that source for this run',async()=>{
  const c=fixture(),run=(await c.flow('start',{workflow:'reconciliation'})).body;
  await checkSources(c,run);
  const old=c.sql.prepare("SELECT version,checked_at FROM source_health WHERE source='marblism'").get();
  assert.equal((await c.work('source-health',{runId:run.id,source:'marblism',expectedVersion:old.version,status:'current',checkedAt:old.checked_at,evidenceUrl:proof[0].url,detail:'No fresh native observation',maxAgeMinutes:45})).status,200);
  const result=await c.flow('finish',{id:run.id,outcome:'checked',summary:'Replayed timestamps',evidence:proof});
  assert.equal(result.status,400);assert.match(result.body.error,/Missing: marblism/);
});
test('historical GitHub-only success stays in history but cannot display a complete current source check',async()=>{
  const c=fixture(),run=(await c.flow('start',{workflow:'reconciliation'})).body;
  const historical=JSON.stringify({summary:'Old run checked only GitHub',checkedSources:['github']});
  c.sql.prepare("UPDATE workflow_runs SET status='checked',finished_at=?,result=? WHERE id=?").run(c.now.toISOString(),historical,run.id);
  const board=await workflowStatus(c.db,c.now),state=board.workflows.find(w=>w.id==='reconciliation');
  assert.equal(state.status,'incomplete');assert.equal(state.lastSuccessAt,null);
  assert.deepEqual(state.requiredSources,requiredSources);
  assert.equal(state.lastRun.result.summary,'Old run checked only GitHub');
  assert.match(board.alerts.find(a=>a.id==='workflow-reconciliation').detail,/did not verify all required sources/);
  assert.equal(c.sql.prepare('SELECT result FROM workflow_runs WHERE id=?').get(run.id).result,historical);
});

for(let round=1;round<=3;round++)test(`scheduled source health has one writer and retains independent audits, round ${round}`,async()=>{
  const c=fixture(),recon=(await c.flow('start',{workflow:'reconciliation'})).body;
  await checkSources(c,recon,['campaign']);
  const before=c.sql.prepare("SELECT * FROM source_health WHERE source='campaign'").get();
  const writes=c.sql.prepare('SELECT count(*) n FROM workflow_run_writes').get().n;
  for(const workflow of ['preparation','coordination']){
    const run=(await c.flow('start',{workflow})).body;
    const result=await c.work('source-health',{runId:run.id,source:'campaign',expectedVersion:before.version,status:'incomplete',checkedAt:new Date(c.now.getTime()+2000).toISOString(),evidenceUrl:proof[0].url,detail:'Another workflow could not access the audit tab',maxAgeMinutes:45});
    assert.equal(result.status,409);assert.match(result.body.error,/owned by reconciliation/);
    assert.deepEqual(c.sql.prepare("SELECT * FROM source_health WHERE source='campaign'").get(),before);
    assert.equal(c.sql.prepare('SELECT count(*) n FROM workflow_run_writes').get().n,writes);
  }
  const audit={source:'campaign',expectedVersion:before.version,status:'incomplete',checkedAt:new Date(c.now.getTime()+3000).toISOString(),evidenceUrl:proof[0].url,detail:'Independent audit found missing native coverage',maxAgeMinutes:45};
  assert.equal((await c.work('source-health',audit)).status,200);
  const after=c.sql.prepare("SELECT * FROM source_health WHERE source='campaign'").get();assert.equal(after.status,'incomplete');assert.equal(after.last_success_at,before.last_success_at);
});
