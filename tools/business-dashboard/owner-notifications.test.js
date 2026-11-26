import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {d1Run} from './test-support/d1-result.js';
import {flushOwnerNotifications,notificationStatus,OWNER_RECIPIENT,OWNER_SENDER} from './src/owner-notifications.js';
import {workflowApi,checkWorkflowDeadlines} from './src/workflow.js';
const initial='2026-11-05T12:00:00.000Z';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const db={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return d1Run(sql,query,this.args);},query};},async batch(statements){sql.exec('BEGIN');try{const r=statements.map(s=>d1Run(sql,s.query,s.args));sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DASHBOARD_DB:db,OWNER_NOTIFICATIONS_ENABLED:'true',OWNER_NOTIFICATION_ENVIRONMENT:'prod',OWNER_RESEND_API_KEY:'fixture-only'};
 const add=(id='urgent:test',created=initial)=>sql.prepare("INSERT INTO owner_notifications(id,kind,environment,subject,body,created_at,next_attempt_at,updated_at) VALUES (?,'failure','prod','JobHackAI update',?,?,?,?)").run(id,'Urgent issue details',created,created,created);
 const row=(id='urgent:test')=>sql.prepare('SELECT * FROM owner_notifications WHERE id=?').get(id);
 const at=minutes=>new Date(Date.parse(initial)+minutes*60000);
 return {sql,db,env,add,row,at};
}
const noFetch=()=>{throw new Error('Unexpected transport');};
const machine={role:'machine',id:'urgent-test',capabilities:['prepare']};
const flowRequest=(action,body)=>new Request(`https://dashboard.jobhackai.io/api/workflow/${action}`,{method:'POST',body:JSON.stringify(body)});
async function beginUrgent(f){return (await workflowApi(flowRequest('start',{workflow:'preparation'}),f.env,machine,f.at(0))).json();}
const urgentInput=run=>({id:run.id,outcome:'failed',summary:'Verified serious issue needs attention.',escalation:'serious_customer_harm'});
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
 assert.match(posted.headers['Idempotency-Key'],/^owner-notice\/prod\/urgent:test$/);
 await flushOwnerNotifications(f.env,f.at(15),async(url,request)=>{assert.equal(request.method,'GET');assert.equal(url,'https://api.resend.com/emails/mail_1');return receipt(f.row());});
 assert.equal(f.row().state,'delivered');assert.equal(f.row().attempts,1);assert.equal(f.row().delivered_at,f.at(15).toISOString());
 await flushOwnerNotifications(f.env,f.at(30),noFetch);
});

test('ambiguous response retries exact immutable payload/key within window, never after expiry',async()=>{
 const f=fixture();f.add();const calls=[];
 const unknown=async(url,r)=>{calls.push(r);throw new Error('connection lost after acceptance');};
 await flushOwnerNotifications(f.env,f.at(0),unknown);await flushOwnerNotifications(f.env,f.at(15),unknown);
 assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.deepEqual(calls[0].headers,calls[1].headers);
 assert.throws(()=>f.sql.prepare("UPDATE owner_notifications SET body='changed' WHERE id=?").run('urgent:test'),/immutable/);
 await flushOwnerNotifications(f.env,f.at(23*60),noFetch);assert.equal(f.row().state,'uncertain');assert.equal(f.row().attempts,2);
 await flushOwnerNotifications(f.env,f.at(48*60),noFetch);
});

test('a crashed sending lease can recover same key; concurrent flush cannot send same notice twice',async()=>{
 const f=fixture();f.add();let release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let calls=0;
 const sending=flushOwnerNotifications(f.env,f.at(0),async()=>{calls++;entered();await gate;return Response.json({id:'mail_1'});});
 await waiting;await flushOwnerNotifications(f.env,f.at(0),noFetch);release();await sending;assert.equal(calls,1);
 const g=fixture();g.add();g.sql.prepare("UPDATE owner_notifications SET state='sending',attempts=1,first_attempt_at=?,lease_until=?,token='crashed' WHERE id=?").run(initial,g.at(1).toISOString(),'urgent:test');
 await flushOwnerNotifications(g.env,g.at(2),async(url,r)=>{assert.equal(r.headers['Idempotency-Key'],'owner-notice/prod/urgent:test');return Response.json({id:'original_mail'});});
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
 await flushOwnerNotifications(g.env,g.at(15),async()=>receipt(g.row(),'bounced'));g.add('urgent:new');
 assert.equal((await flushOwnerNotifications(g.env,g.at(30),noFetch)).status,'suppressed');
});

test('environment and receipt payload cannot change across retries or credential reconfiguration',async()=>{
 const f=fixture();f.add();f.env.OWNER_NOTIFICATION_ENVIRONMENT='qa';await flushOwnerNotifications(f.env,f.at(0),noFetch);assert.equal(f.row().attempts,0);
 f.env.OWNER_NOTIFICATION_ENVIRONMENT='prod';await flushOwnerNotifications(f.env,f.at(0),async()=>{throw new Error('timeout');});
 f.env.OWNER_NOTIFICATION_ENVIRONMENT='qa';await flushOwnerNotifications(f.env,f.at(30),noFetch);assert.equal(f.row().attempts,1);
 assert.throws(()=>f.sql.prepare("UPDATE owner_notifications SET environment='qa'").run(),/immutable/);
});



test('advanced completion keeps work evidence without queuing email or depending on its outbox',async()=>{
 const f=fixture(),identity={role:'machine',id:'test',capabilities:['prepare']};
 f.sql.exec("CREATE TRIGGER reject_notice BEFORE INSERT ON owner_notifications BEGIN SELECT RAISE(ABORT,'unexpected_notice'); END");
 const run=await (await workflowApi(flowRequest('start',{workflow:'preparation'}),f.env,identity,f.at(0))).json();
 f.sql.prepare("INSERT INTO workflow_run_writes(run_id,kind,reference,version,result,recorded_at) VALUES (?,'item','result',1,?,?)").run(run.id,JSON.stringify({advanced:true,checked:true}),initial);
 const input={id:run.id,outcome:'advanced',summary:'Partner readiness evidence was completed.',evidence:[{url:'https://example.test/proof',fact:'Independent acceptance read'}]};
 const finished=await workflowApi(flowRequest('finish',input),f.env,identity,f.at(1),async()=>({items:[]}));
 assert.equal(finished.status,200);
 const saved=f.sql.prepare('SELECT status,result FROM workflow_runs WHERE id=?').get(run.id);
 assert.equal(saved.status,'advanced');assert.equal(JSON.parse(saved.result).summary,input.summary);
 assert.deepEqual(JSON.parse(saved.result).advancedItems,['result']);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM owner_notifications').get().n,0);
 assert.equal((await workflowApi(flowRequest('finish',input),f.env,identity,f.at(1))).status,409);
 await flushOwnerNotifications(f.env,f.at(15),noFetch);
});



 test('delivered receipts remain monitored for late complaint and provider suppression stops the route',async()=>{
 for(const terminal of ['complained','suppressed']){
 const f=fixture();f.add();await flushOwnerNotifications(f.env,f.at(0),async()=>Response.json({id:'mail_1'}));
 await flushOwnerNotifications(f.env,f.at(15),async()=>receipt(f.row()));const delivered=f.row().delivered_at;f.add('urgent:second',f.at(1455).toISOString());
 await flushOwnerNotifications(f.env,f.at(1455),async(url,r)=>{assert.equal(r.method,'GET');return receipt(f.row(),terminal);});
 assert.equal(f.row().state,'failed');assert.equal(f.row().delivered_at,delivered);assert.equal(f.row('urgent:second').attempts,0);
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
 f.db.prepare=query=>{if(query.includes("SET state='sending',attempts=attempts+1")&&!inserted){inserted=true;f.add('urgent:complaint');f.sql.prepare("UPDATE owner_notifications SET state='failed',last_reason='provider_suppressed' WHERE id='urgent:complaint'").run();}return original(query);};
 await flushOwnerNotifications(f.env,f.at(0),noFetch);assert.equal(f.row().attempts,0);assert.equal(inserted,true);
 });



test('urgent completion dispatches without a cron tick and bypasses ordinary backlog',async()=>{
 const f=fixture();f.add();const run=await beginUrgent(f);let calls=0;
 const response=await workflowApi(flowRequest('finish',urgentInput(run)),f.env,machine,f.at(1),null,{transport:async(url,r)=>{
  calls++;assert.equal(r.headers['Idempotency-Key'],`owner-notice/prod/urgent:${run.id}`);
  const body=JSON.parse(r.body);assert.deepEqual(body.to,[OWNER_RECIPIENT]);assert.match(body.text,/A customer may be seriously affected/);assert.match(body.text,/What you need to do/);assert.doesNotMatch(body.text,/lease|canonical|snapshot|2026-/);
  return Response.json({id:'urgent_mail'});
 }});
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal(f.row(`urgent:${run.id}`).state,'accepted');assert.equal(f.row().attempts,0);
 const replay=await workflowApi(flowRequest('finish',urgentInput(run)),f.env,machine,f.at(1),null,{transport:noFetch});
 assert.equal(replay.status,409);
 delete f.env.OWNER_RESEND_API_KEY;
 await checkWorkflowDeadlines(f.env,f.at(2));await checkWorkflowDeadlines(f.env,f.at(3));
 assert.equal(f.sql.prepare("SELECT count(*) n FROM owner_notifications WHERE kind='failure'").get().n,2);
});

test('urgent persistence is atomic, rejects invalid callers and respects disabled transport',async()=>{
 for(const mode of ['disabled','invalid','foreign','storage']){
  const f=fixture(),run=await beginUrgent(f),input=urgentInput(run);let calls=0;
  if(mode==='disabled')f.env.OWNER_NOTIFICATIONS_ENABLED='false';
  if(mode==='invalid')input.escalation='send_anywhere';
  if(mode==='storage')f.sql.exec("CREATE TRIGGER reject_notice BEFORE INSERT ON owner_notifications BEGIN SELECT RAISE(ABORT,'urgent_storage_failure'); END");
  const action=()=>workflowApi(flowRequest('finish',input),f.env,mode==='foreign'?{...machine,id:'someone-else'}:machine,f.at(1),null,{transport:async()=>{calls++;return Response.json({id:'unexpected'});}});
  if(mode==='storage')await assert.rejects(action,/urgent_storage_failure/);
  else assert.equal((await action()).status,mode==='disabled'?200:mode==='foreign'?403:400);
  assert.equal(calls,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM owner_notifications').get().n,0);
  assert.equal(f.sql.prepare('SELECT status FROM workflow_runs WHERE id=?').get(run.id).status,mode==='disabled'?'failed':'running');
 }
});

test('waitUntil keeps urgent delivery alive, concurrent monitor cannot duplicate it, failures remain retryable',async()=>{
 const f=fixture(),run=await beginUrgent(f);let entered,release,calls=0;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r),background=[];
 const response=await workflowApi(flowRequest('finish',urgentInput(run)),f.env,machine,f.at(1),null,{ctx:{waitUntil:p=>background.push(p)},transport:async()=>{calls++;entered();await gate;throw new Error('ambiguous timeout');}});
 assert.equal(response.status,200);await waiting;
 await flushOwnerNotifications(f.env,f.at(1),async()=>{calls++;return Response.json({id:'unexpected'});});assert.equal(calls,1);
 release();await Promise.all(background);const notice=f.row(`urgent:${run.id}`);assert.equal(notice.state,'pending');assert.equal(notice.attempts,1);
 f.add('urgent:test',f.at(16).toISOString());await flushOwnerNotifications(f.env,f.at(16),async(url,r)=>{assert.equal(r.headers['Idempotency-Key'],`owner-notice/prod/urgent:${run.id}`);return Response.json({id:'recovered'});});
 assert.equal(f.row(`urgent:${run.id}`).state,'accepted');assert.equal(f.row().attempts,0);
});



test('an urgent saved event preserves later internal missed-run detection without another email',async()=>{
 const f=fixture();delete f.env.OWNER_RESEND_API_KEY;const run=await beginUrgent(f);
 await workflowApi(flowRequest('finish',urgentInput(run)),f.env,machine,f.at(1),null,{transport:noFetch});
 // A successful completion may also carry an urgent business escalation. Its
 // notice must not satisfy the separate expectation for a later scheduled run.
 f.sql.prepare("UPDATE workflow_runs SET status='checked' WHERE id=?").run(run.id);
 const status=await checkWorkflowDeadlines(f.env,f.at(240));
 assert.equal(status.workflows.find(w=>w.id==='preparation').status,'missing');
 assert.equal(f.sql.prepare("SELECT count(*) n FROM owner_notifications WHERE kind='failure'").get().n,1);
});





function legacyBrief(f,id='brief:legacy',state='pending',attempts=0,environment='prod'){
 f.sql.prepare("INSERT INTO owner_notifications(id,kind,environment,subject,body,created_at,next_attempt_at,updated_at,state,attempts,first_attempt_at) VALUES(?,'brief',?,'JobHackAI: Work completed','Original internal work summary',?,?,?,?,?,?)")
  .run(id,environment,initial,initial,initial,state,attempts,attempts?initial:null);
 return id;
}
test('existing routine backlog is retired without deletion or sends across repeated ticks',async()=>{
 const f=fixture();const id=legacyBrief(f);let calls=0;
 const transport=async()=>{calls++;return Response.json({id:'unexpected'});};
 const before=f.row(id);
 for(const minute of [0,15,30])await flushOwnerNotifications(f.env,f.at(minute),transport);
 assert.equal(calls,0);assert.equal(f.row(id).state,'failed');assert.equal(f.row(id).last_reason,'routine_notice_retired');
 for(const key of ['body','subject','created_at','attempts','provider_id'])assert.equal(f.row(id)[key],before[key]);
 assert.deepEqual((await notificationStatus(f.env)).reviewRequired,[]);
});
test('uncertain routine attempts are held, live leases survive, and other environments are untouched',async()=>{
 const f=fixture();legacyBrief(f,'brief:pending','pending',1);legacyBrief(f,'brief:expired','sending',1);legacyBrief(f,'brief:live','sending',1);legacyBrief(f,'brief:qa','pending',0,'qa');
 f.sql.prepare("UPDATE owner_notifications SET token='old-lease',lease_until=? WHERE id IN ('brief:expired','brief:live')").run(f.at(1).toISOString());
 let calls=0;const transport=async()=>{calls++;return Response.json({id:'unexpected'});};
 await flushOwnerNotifications(f.env,f.at(0),transport);
 assert.equal(f.row('brief:live').state,'sending');assert.equal(f.row('brief:live').token,'old-lease');assert.equal(f.row('brief:qa').state,'pending');
 await flushOwnerNotifications(f.env,f.at(2),transport);
 for(const id of ['brief:pending','brief:expired','brief:live']){assert.equal(f.row(id).state,'uncertain');assert.equal(f.row(id).attempts,1);assert.equal(f.row(id).last_reason,'routine_send_outcome_requires_review');}
 assert.equal(calls,0);assert.equal((await notificationStatus(f.env)).reviewRequired.some(r=>r.last_reason==='routine_send_outcome_requires_review'),true);
});
test('a stale writer inserting a routine notice at the send claim cannot bypass the policy',async()=>{
 const f=fixture(),prepare=f.db.prepare;let inserted=false,calls=0;
 f.db.prepare=query=>{if(query.includes("SET state='sending',attempts=attempts+1")&&!inserted){inserted=true;legacyBrief(f);}return prepare(query);};
 await flushOwnerNotifications(f.env,f.at(0),async()=>{calls++;return Response.json({id:'unexpected'});});
 assert.equal(inserted,true);assert.equal(calls,0);assert.equal(f.row('brief:legacy').attempts,0);
 await flushOwnerNotifications(f.env,f.at(15),async()=>{calls++;return Response.json({id:'unexpected'});});
 assert.equal(calls,0);assert.equal(f.row('brief:legacy').last_reason,'routine_notice_retired');
});
test('already accepted routine mail still gets receipt monitoring and complaint protection',async()=>{
 const f=fixture();const id=legacyBrief(f,'brief:accepted','accepted',1);
 f.sql.prepare("UPDATE owner_notifications SET provider_id='historical-provider',accepted_at=?,next_poll_at=? WHERE id=?").run(initial,initial,id);
 f.add();let reads=0,posts=0;
 await flushOwnerNotifications(f.env,f.at(0),async(url,r)=>{if(r.method==='POST'){posts++;return Response.json({id:'unexpected'});}reads++;return receipt(f.row(id),'complained');});
 assert.equal(reads,1);assert.equal(posts,0);assert.equal(f.row(id).last_reason,'provider_complained');assert.equal(f.row(id).provider_id,'historical-provider');
 assert.equal(f.row().attempts,0);assert.equal((await notificationStatus(f.env)).status,'suppressed');
});
test('real deadline checker retires briefs while preserving its scheduled monitoring work',async()=>{
 const f=fixture();legacyBrief(f);
 // Pause fixture workflows to avoid fabricating an incident and any real transport.
 f.env.DASHBOARD_WORKFLOW_POLICIES=JSON.stringify(Object.fromEntries(['preparation','reconciliation','coordination'].map(k=>[k,{mode:'paused',reason:'isolated test'}])));
 for(const minute of [0,15,30]){const result=await checkWorkflowDeadlines(f.env,f.at(minute));assert.equal(result.ownerNotifications.attempted,0);assert.equal(result.ownerNotifications.polled,0);}
 assert.equal(f.row('brief:legacy').last_reason,'routine_notice_retired');
 assert.equal(f.sql.prepare('SELECT count(*) n FROM owner_notifications').get().n,1);
});

// D1 limits LIKE/GLOB patterns to 50 bytes. Real episode prefixes exceed that.


test('late, restarted and stalled work still changes internal alerts without sending owner email',async()=>{
 const f=fixture();const realFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({id:'unexpected'});};
 try{
  f.sql.prepare("INSERT INTO workflow_runs(id,workflow,period,actor,status,started_at,finished_at,lease_until,baseline,result) VALUES('late','preparation','x','owner','failed',?,?,?,'{}',?)").run(initial,initial,f.at(60).toISOString(),JSON.stringify({summary:'Task did not finish'}));
  await checkWorkflowDeadlines(f.env,f.at(240));
  assert.equal(f.sql.prepare("SELECT count(*) n FROM workflow_alerts WHERE id='workflow-preparation' AND resolved_at IS NULL").get().n,1);
  f.sql.prepare("UPDATE workflow_runs SET status='running',lease_until=? WHERE id='late'").run(f.at(300).toISOString());
  await checkWorkflowDeadlines(f.env,f.at(241));
  assert.ok(f.sql.prepare("SELECT resolved_at FROM workflow_alerts WHERE id='workflow-preparation'").get().resolved_at);
  await checkWorkflowDeadlines(f.env,f.at(301));await checkWorkflowDeadlines(f.env,f.at(500));
  assert.equal(f.sql.prepare("SELECT count(*) n FROM workflow_alerts WHERE id='workflow-preparation' AND resolved_at IS NULL").get().n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM owner_notifications').get().n,0);assert.equal(calls,0);
 }finally{globalThis.fetch=realFetch;}
});

test('legacy delay and recovery queues are held, including uncertain attempts and stale inserts',async()=>{
 for(const kind of ['failure','recovery'])for(const state of ['pending','sending']){
  const f=fixture();f.sql.prepare("INSERT INTO owner_notifications(id,kind,environment,subject,body,created_at,next_attempt_at,updated_at,state,attempts,first_attempt_at) VALUES(?,?,'prod','Old monitoring mail','Original body',?,?,?,?,?,?)").run(`${kind}:legacy`,kind,initial,initial,initial,state,state==='sending'?1:0,state==='sending'?initial:null);
  let calls=0;for(const t of [0,15,30])await flushOwnerNotifications(f.env,f.at(t),async()=>{calls++;return Response.json({id:'unexpected'});});
  const row=f.row(`${kind}:legacy`);assert.equal(calls,0);assert.equal(row.body,'Original body');assert.equal(row.state,state==='sending'?'uncertain':'failed');assert.equal(row.attempts,state==='sending'?1:0);
 }
 const f=fixture(),prepare=f.db.prepare;let inserted=false,calls=0;
 f.db.prepare=query=>{if(query.includes("SET state='sending',attempts=attempts+1")&&!inserted){inserted=true;f.sql.prepare("INSERT INTO owner_notifications(id,kind,environment,subject,body,created_at,next_attempt_at,updated_at) VALUES('recovery:stale','recovery','prod','Warning cleared','Old template',?,?,?)").run(initial,initial,initial);}return prepare(query);};
 await flushOwnerNotifications(f.env,f.at(0),async()=>{calls++;return Response.json({id:'unexpected'});});assert.equal(inserted,true);assert.equal(calls,0);assert.equal(f.row('recovery:stale').attempts,0);
});

test('urgent completion persists and dispatches each allowed business escalation without generic monitoring mail',async()=>{
 for(const escalation of ['serious_customer_harm','uncontrolled_spending','commitment_at_risk']){
  const f=fixture(),run=await beginUrgent(f);let posts=0;
  const r=await workflowApi(flowRequest('finish',{...urgentInput(run),escalation}),f.env,machine,f.at(1),null,{transport:async(url,request)=>{posts++;const body=JSON.parse(request.body);assert.match(body.text,/What happened[\s\S]*What you need to do/);assert.doesNotMatch(body.text,/snapshot|lease|2026-/);return Response.json({id:'urgent_mail'});}});
  assert.equal(r.status,200);assert.equal(posts,1);assert.equal(f.row(`urgent:${run.id}`).state,'accepted');assert.equal(f.sql.prepare('SELECT count(*) n FROM owner_notifications').get().n,1);
 }
});
