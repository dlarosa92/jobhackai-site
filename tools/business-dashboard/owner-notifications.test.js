import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {d1Run} from './test-support/d1-result.js';
import {flushOwnerNotifications,notificationStatus,OWNER_RECIPIENT,OWNER_SENDER,COMPANY_BRIEF} from './src/owner-notifications.js';
import {workflowApi,checkWorkflowDeadlines} from './src/workflow.js';
const initial='2026-11-05T12:00:00.000Z';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const db={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return d1Run(sql,query,this.args);},query};},async batch(statements){sql.exec('BEGIN');try{const r=statements.map(s=>d1Run(sql,s.query,s.args));sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DASHBOARD_DB:db,OWNER_NOTIFICATIONS_ENABLED:'true',OWNER_NOTIFICATION_ENVIRONMENT:'prod',OWNER_RESEND_API_KEY:'fixture-only'};
 const add=(id='brief:test',created=initial)=>sql.prepare("INSERT INTO owner_notifications(id,kind,environment,subject,body,created_at,next_attempt_at,updated_at) VALUES (?,'brief','prod','JobHackAI update',?,?,?,?)").run(id,`Useful result\n${COMPANY_BRIEF}`,created,created,created);
 const row=(id='brief:test')=>sql.prepare('SELECT * FROM owner_notifications WHERE id=?').get(id);
 const at=minutes=>new Date(Date.parse(initial)+minutes*60000);
 return {sql,db,env,add,row,at};
}
const noFetch=()=>{throw new Error('Unexpected transport');};
function receipt(row,last_event='delivered',extra={}){return Response.json({id:row.provider_id,to:[OWNER_RECIPIENT],from:OWNER_SENDER,subject:row.subject,text:row.body,last_event,cc:[],bcc:[],...extra});}

test('off by default, missing credentials and missing migration are visible without transport',async()=>{
 const f=fixture();f.add();delete f.env.OWNER_NOTIFICATIONS_ENABLED;
 assert.equal((await flushOwnerNotifications(f.env,f.at(0),noFetch)).status,'disabled');assert.equal(f.row().attempts,0);
 f.env.OWNER_NOTIFICATIONS_ENABLED='true';delete f.env.OWNER_RESEND_API_KEY;
 assert.equal((await notificationStatus(f.env)).status,'missing_configuration');
 assert.equal((await flushOwnerNotifications(f.env,f.at(0),noFetch)).status,'missing_configuration');assert.equal(f.row().attempts,0);
 f.sql.exec('DROP TABLE owner_notifications');assert.equal((await notificationStatus(f.env)).status,'unavailable');
});

test('one fixed-recipient send retains provider ID; later exact receipt alone establishes delivered',async()=>{
 const f=fixture();f.add();let posted;
 await flushOwnerNotifications(f.env,f.at(0),async(url,request)=>{posted={url,...request};return Response.json({id:'mail_1'});});
 assert.equal(f.row().state,'accepted');assert.equal(f.row().provider_id,'mail_1');assert.equal(f.row().delivered_at,null);
 assert.deepEqual(JSON.parse(posted.body),{from:OWNER_SENDER,to:[OWNER_RECIPIENT],subject:'JobHackAI update',text:f.row().body});
 assert.match(posted.headers['Idempotency-Key'],/^owner-notice\/prod\/brief:test$/);
 await flushOwnerNotifications(f.env,f.at(15),async(url,request)=>{assert.equal(request.method,'GET');assert.equal(url,'https://api.resend.com/emails/mail_1');return receipt(f.row());});
 assert.equal(f.row().state,'delivered');assert.equal(f.row().attempts,1);assert.equal(f.row().delivered_at,f.at(15).toISOString());
 await flushOwnerNotifications(f.env,f.at(30),noFetch);
});

test('ambiguous response retries exact immutable payload/key within window, never after expiry',async()=>{
 const f=fixture();f.add();const calls=[];
 const unknown=async(url,r)=>{calls.push(r);throw new Error('connection lost after acceptance');};
 await flushOwnerNotifications(f.env,f.at(0),unknown);await flushOwnerNotifications(f.env,f.at(15),unknown);
 assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.deepEqual(calls[0].headers,calls[1].headers);
 assert.throws(()=>f.sql.prepare("UPDATE owner_notifications SET body='changed' WHERE id=?").run('brief:test'),/immutable/);
 await flushOwnerNotifications(f.env,f.at(23*60),noFetch);assert.equal(f.row().state,'uncertain');assert.equal(f.row().attempts,2);
 await flushOwnerNotifications(f.env,f.at(48*60),noFetch);
});

test('a crashed sending lease can recover same key; concurrent flush cannot send same notice twice',async()=>{
 const f=fixture();f.add();let release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let calls=0;
 const sending=flushOwnerNotifications(f.env,f.at(0),async()=>{calls++;entered();await gate;return Response.json({id:'mail_1'});});
 await waiting;await flushOwnerNotifications(f.env,f.at(0),noFetch);release();await sending;assert.equal(calls,1);
 const g=fixture();g.add();g.sql.prepare("UPDATE owner_notifications SET state='sending',attempts=1,first_attempt_at=?,lease_until=?,token='crashed' WHERE id=?").run(initial,g.at(1).toISOString(),'brief:test');
 await flushOwnerNotifications(g.env,g.at(2),async(url,r)=>{assert.equal(r.headers['Idempotency-Key'],'owner-notice/prod/brief:test');return Response.json({id:'original_mail'});});
 assert.equal(g.row().provider_id,'original_mail');assert.equal(g.row().attempts,2);
});

test('unknown send attempts cap, hard rejection, stale unsent expiry and receipt mismatch do not resend',async()=>{
 const f=fixture();f.add();for(const minute of [0,15,45,105,165])await flushOwnerNotifications(f.env,f.at(minute),async()=>{throw new Error('timeout');});
 await flushOwnerNotifications(f.env,f.at(225),noFetch);assert.equal(f.row().state,'uncertain');assert.equal(f.row().attempts,5);
 const g=fixture();g.add();const rejected=await flushOwnerNotifications(g.env,g.at(0),async()=>new Response('',{status:403}));assert.equal(rejected.attempted,1);assert.equal('sent' in rejected,false);assert.equal(g.row().state,'failed');
 const h=fixture();h.add();await flushOwnerNotifications(h.env,h.at(24*60),noFetch);assert.equal(h.row().last_reason,'unsent_notice_expired');
 const i=fixture();i.add();await flushOwnerNotifications(i.env,i.at(0),async()=>Response.json({id:'mail_1'}));
 await flushOwnerNotifications(i.env,i.at(15),async()=>receipt(i.row(),'delivered',{to:['someone@example.test']}));assert.equal(i.row().state,'uncertain');assert.equal(i.row().last_reason,'provider_receipt_mismatch');
});

test('receipt failures cannot resend and polling stops visibly; a bounce suppresses later owner sends',async()=>{
 const f=fixture();f.add();await flushOwnerNotifications(f.env,f.at(0),async()=>Response.json({id:'mail_1'}));
 for(let i=0;i<48;i++)await flushOwnerNotifications(f.env,f.at(15+i*60),async(url,r)=>{assert.equal(r.method,'GET');return new Response('',{status:403});});
 assert.equal(f.row().state,'accepted');assert.equal(f.row().last_reason,'delivery_receipt_requires_review');assert.equal(f.row().next_poll_at,null);
 await flushOwnerNotifications(f.env,f.at(3000),noFetch);assert.equal(f.row().attempts,1);
 const g=fixture();g.add();await flushOwnerNotifications(g.env,g.at(0),async()=>Response.json({id:'mail_1'}));
 await flushOwnerNotifications(g.env,g.at(15),async()=>receipt(g.row(),'bounced'));g.add('brief:new');
 assert.equal((await flushOwnerNotifications(g.env,g.at(30),noFetch)).status,'suppressed');
});

test('environment and receipt payload cannot change across retries or credential reconfiguration',async()=>{
 const f=fixture();f.add();f.env.OWNER_NOTIFICATION_ENVIRONMENT='qa';await flushOwnerNotifications(f.env,f.at(0),noFetch);assert.equal(f.row().attempts,0);
 f.env.OWNER_NOTIFICATION_ENVIRONMENT='prod';await flushOwnerNotifications(f.env,f.at(0),async()=>{throw new Error('timeout');});
 f.env.OWNER_NOTIFICATION_ENVIRONMENT='qa';await flushOwnerNotifications(f.env,f.at(30),noFetch);assert.equal(f.row().attempts,1);
 assert.throws(()=>f.sql.prepare("UPDATE owner_notifications SET environment='qa'").run(),/immutable/);
});

test('deadline episode queues once, unchanged checks stay quiet and recovery preserves old episode',async()=>{
 const f=fixture();delete f.env.OWNER_RESEND_API_KEY;
 await checkWorkflowDeadlines(f.env,f.at(0));
 // One real failed workflow rather than relying on fixture creation timestamps.
 f.sql.prepare("INSERT INTO workflow_runs(id,workflow,period,actor,status,started_at,finished_at,lease_until,baseline,result) VALUES('r','preparation','x','owner','failed',?,?,?,'{}',?)")
 .run(initial,initial,f.at(60).toISOString(),JSON.stringify({summary:'Source inaccessible'}));
 await checkWorkflowDeadlines(f.env,f.at(1));await checkWorkflowDeadlines(f.env,f.at(2));
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM owner_notifications WHERE kind='failure'").get().n,1);
 f.sql.prepare("UPDATE owner_notifications SET attempts=1,first_attempt_at=? WHERE kind='failure'").run(initial);
 f.env.DASHBOARD_WORKFLOW_POLICIES=JSON.stringify({preparation:{mode:'paused',reason:'Owner deliberately paused'}});
 await checkWorkflowDeadlines(f.env,f.at(3));await checkWorkflowDeadlines(f.env,f.at(4));
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM owner_notifications WHERE kind='recovery'").get().n,1);
 const read=await workflowApi(new Request('https://dashboard.jobhackai.io/api/workflow'),f.env,{role:'owner'},f.at(4));
 assert.equal((await read.json()).ownerNotifications.status,'missing_configuration');
});

test('only authenticated advanced receipts queue a brief, atomically with run completion',async()=>{
 const f=fixture(),identity={role:'machine',id:'test',capabilities:['prepare']};delete f.env.OWNER_RESEND_API_KEY;
 const request=(action,body)=>new Request(`https://dashboard.jobhackai.io/api/workflow/${action}`,{method:'POST',body:JSON.stringify(body)});
 const begin=await workflowApi(request('start',{workflow:'preparation'}),f.env,identity,f.at(0));const run=await begin.json();
 f.sql.prepare("INSERT INTO workflow_run_writes(run_id,kind,reference,version,result,recorded_at) VALUES (?,'item','result',1,?,?)").run(run.id,JSON.stringify({advanced:true,checked:true}),initial);
 const input={id:run.id,outcome:'advanced',summary:'Partner readiness evidence was completed.',evidence:[{url:'https://example.test/proof',fact:'Independent acceptance read'}],to:'unwanted@example.test',body:'Cannot choose message payload'};
 const finished=await workflowApi(request('finish',input),f.env,identity,f.at(1),async()=>({items:[]}));assert.equal(finished.status,200);
 const notice=f.sql.prepare('SELECT * FROM owner_notifications').get();assert.equal(notice.id,`brief:${run.id}`);assert.match(notice.body,/Partner readiness/);assert.doesNotMatch(notice.body,/unwanted|Cannot choose/);
 assert.equal((await workflowApi(request('finish',input),f.env,identity,f.at(1))).status,409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM owner_notifications').get().n,1);
 const g=fixture();delete g.env.OWNER_RESEND_API_KEY;const second=await workflowApi(request('start',{workflow:'preparation'}),g.env,identity,g.at(0));const another=await second.json();
 g.sql.prepare("INSERT INTO workflow_run_writes(run_id,kind,reference,version,result,recorded_at) VALUES (?,'item','result',1,?,?)").run(another.id,JSON.stringify({advanced:true,checked:true}),initial);
 g.sql.exec("CREATE TRIGGER reject_notice BEFORE INSERT ON owner_notifications BEGIN SELECT RAISE(ABORT,'test_storage_failure'); END");
 await assert.rejects(workflowApi(request('finish',{...input,id:another.id}),g.env,identity,g.at(1)),/test_storage_failure/);
 assert.equal(g.sql.prepare('SELECT status FROM workflow_runs WHERE id=?').get(another.id).status,'running');
});

 test('a failure resolved before any dispatch is held without sending an obsolete recovery',async()=>{
 const f=fixture();delete f.env.OWNER_RESEND_API_KEY;
 f.sql.prepare("INSERT INTO workflow_runs(id,workflow,period,actor,status,started_at,finished_at,lease_until,baseline,result) VALUES('r','preparation','x','owner','failed',?,?,?,'{}',?)").run(initial,initial,f.at(60).toISOString(),JSON.stringify({summary:'Temporary source error'}));
 await checkWorkflowDeadlines(f.env,f.at(1));
 f.env.DASHBOARD_WORKFLOW_POLICIES=JSON.stringify({preparation:{mode:'paused',reason:'Deliberately paused'}});
 await checkWorkflowDeadlines(f.env,f.at(2));
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM owner_notifications WHERE kind='recovery'").get().n,0);
 assert.equal(f.sql.prepare("SELECT last_reason FROM owner_notifications WHERE kind='failure'").get().last_reason,'resolved_before_dispatch');
 f.env.OWNER_RESEND_API_KEY='fixture-only';await flushOwnerNotifications(f.env,f.at(3),noFetch);
 });

test('receipt polling precedes new dispatch so a newly observed bounce stops queued notices',async()=>{
 const f=fixture();f.add();await flushOwnerNotifications(f.env,f.at(0),async()=>Response.json({id:'mail_1'}));f.add('brief:second');
 let reads=0;const status=await flushOwnerNotifications(f.env,f.at(15),async(url,r)=>{assert.equal(r.method,'GET');reads++;return receipt(f.row(),'complained');});
 assert.equal(reads,1);assert.equal(status.status,'suppressed');assert.equal(f.row('brief:second').attempts,0);
});

 test('delivered receipts remain monitored for late complaint and provider suppression stops the route',async()=>{
 for(const terminal of ['complained','suppressed']){
 const f=fixture();f.add();await flushOwnerNotifications(f.env,f.at(0),async()=>Response.json({id:'mail_1'}));
 await flushOwnerNotifications(f.env,f.at(15),async()=>receipt(f.row()));const delivered=f.row().delivered_at;f.add('brief:second',f.at(1455).toISOString());
 await flushOwnerNotifications(f.env,f.at(1455),async(url,r)=>{assert.equal(r.method,'GET');return receipt(f.row(),terminal);});
 assert.equal(f.row().state,'failed');assert.equal(f.row().delivered_at,delivered);assert.equal(f.row('brief:second').attempts,0);
 assert.equal((await notificationStatus(f.env)).status,'suppressed');
 }
 });
 test('delivered receipt polling ends with an explicit seven-day coverage limit and no resend',async()=>{
 const f=fixture();f.add();await flushOwnerNotifications(f.env,f.at(0),async()=>Response.json({id:'mail_1'}));
 await flushOwnerNotifications(f.env,f.at(15),async()=>receipt(f.row()));const delivered=f.row().delivered_at;
 await flushOwnerNotifications(f.env,f.at(1455),async()=>receipt(f.row()));assert.equal(f.row().delivered_at,delivered);
 await flushOwnerNotifications(f.env,f.at(7*1440+15),noFetch);assert.equal(f.row().state,'delivered');assert.equal(f.row().last_reason,'complaint_monitoring_window_closed');
 });

 test('late delivery receives a fresh independent complaint-monitoring window',async()=>{
 const f=fixture();f.add();await flushOwnerNotifications(f.env,f.at(0),async()=>Response.json({id:'mail_1'}));
 f.sql.prepare("UPDATE owner_notifications SET poll_attempts=47,next_poll_at=?").run(f.at(47*60).toISOString());
 await flushOwnerNotifications(f.env,f.at(47*60),async()=>receipt(f.row()));assert.equal(f.row().state,'delivered');assert.equal(f.row().delivery_poll_attempts,0);assert.notEqual(f.row().next_poll_at,null);
 await flushOwnerNotifications(f.env,f.at(47*60+1440),async()=>receipt(f.row(),'complained'));assert.equal(f.row().state,'failed');assert.equal(f.row().delivery_poll_attempts,1);
 });
 test('atomic dispatch claim rechecks a concurrently recorded suppression',async()=>{
 const f=fixture();f.add();const original=f.db.prepare.bind(f.db);let inserted=false;
 f.db.prepare=query=>{if(query.includes("SET state='sending',attempts=attempts+1")&&!inserted){inserted=true;f.add('brief:complaint');f.sql.prepare("UPDATE owner_notifications SET state='failed',last_reason='provider_suppressed' WHERE id='brief:complaint'").run();}return original(query);};
 await flushOwnerNotifications(f.env,f.at(0),noFetch);assert.equal(f.row().attempts,0);assert.equal(inserted,true);
 });
