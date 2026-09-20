import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { openManagedInterview, closeManagedInterview } from '../voice-managed-interview.js';
import { beginDeletionAdmission, assertDeletionQuiescent } from '../account-deletion-admission.js';
import { withAccountOperation } from '../account-operation-scope.js';
import { getVoiceEntitlement } from '../voice-entitlements.js';
import { deadlineBinding } from './voice-deadline-fixture.mjs';
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const SDP='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const FIRST='11111111-1111-4111-8111-111111111111';
const SECOND='22222222-2222-4222-8222-222222222222';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(t) {
  const db=sqliteD1();t.after(()=>db.close());
  for(const name of ['schema.sql','migrations/028_account_deletion_recovery.sql']) db.exec(readFileSync(new URL('../../../db/'+name,import.meta.url),'utf8'));
  db.exec("INSERT INTO users(id,auth_id,email) VALUES(1,'owner','owner@example.test'),(2,'other','other@example.test')");
  const env={DB:db,OPENAI_API_KEY:'sk-test-private-fixture',VOICE_INTERVIEW_ENABLED:'true',VOICE_MANAGED_CALLS_ENABLED:'true'};
  env.VOICE_DEADLINES=deadlineBinding(db);
  const calls=[];const realFetch=globalThis.fetch;let handler=null;
  globalThis.fetch=async(url,init)=>{
    const call={url:String(url),init};calls.push(call);
    return handler?handler(call):String(url).endsWith('/hangup')?new Response(null,{status:200}):new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_'+calls.length}});
  };
  t.after(()=>{globalThis.fetch=realFetch;});
  return {db,env,calls,setHandler:fn=>{handler=fn;},
    open:(options={})=>openManagedInterview(env,{uid:'owner',sessionId:FIRST,sdp:SDP,role:'Engineer',firstName:'Pat',...options}),
    close:(sessionId=FIRST)=>closeManagedInterview(env,{uid:'owner',sessionId}),
    user:()=>db.prepare("SELECT * FROM users WHERE auth_id='owner'").first(),
    sessions:async()=> (await db.prepare('SELECT * FROM voice_sessions').all()).results,
    controls:()=>db.prepare('SELECT * FROM voice_interview_controls WHERE session_id=?').bind(FIRST).first()};
}

test('SDP is returned only after the owned provider call and one free reservation exist',async t=>{
  const f=fixture(t);f.setHandler(async({init})=>{
    assert.equal((await f.user()).free_session_used,0);assert.equal((await f.sessions()).length,0);
    const config=JSON.parse(init.body.get('session'));assert.equal(config.model,'gpt-realtime-mini');assert.equal(config.audio.output.voice,'marin');
    return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_first'}});
  });
  const result=await f.open();assert.equal(result.sdp,SDP);assert.equal(result.mode,'free');assert.equal(result.resumed,false);
  assert.equal((await f.user()).free_session_used,1);assert.equal((await f.sessions()).length,1);
  assert.equal((await f.controls()).current_attempt_id,result.attemptId);assert.equal(result.clientSecret,undefined);
});

for (const receipt of [null,{armed:false},{armed:true,sessionId:FIRST,deadlineAt:'wrong'}]) {
  test('missing or unacknowledged deadline prevents provider creation and credit consumption: '+JSON.stringify(receipt),async t=>{
    const f=fixture(t);
    f.env.VOICE_DEADLINES=receipt===null?undefined:{getByName(){return {async arm(){return receipt;}}}};
    await assert.rejects(f.open(),/voice_connection_deadline_unavailable/);
    assert.equal(f.calls.length,0);assert.equal((await f.user()).free_session_used,0);assert.equal((await f.sessions()).length,0);
  });
}

test('lost scheduling receipt keeps the same interview and retry does not reset its deadline',async t=>{
  const f=fixture(t),binding=f.env.VOICE_DEADLINES;
  f.env.VOICE_DEADLINES={getByName(id){return {async arm(request){
    await binding.getByName(id).arm(request);throw Error('private transport diagnostic');
  }}}};
  await assert.rejects(f.open(),/voice_connection_deadline_unavailable/);const initial=await f.controls();
  assert.equal(f.calls.length,0);f.env.VOICE_DEADLINES=binding;
  const result=await f.open();assert.equal(result.deadlineAt,initial.deadline_at);assert.equal((await f.sessions()).length,1);
});

test('scheduler failure during reconnect leaves the previous provider connection alone',async t=>{
  const f=fixture(t),first=await f.open();delete f.env.VOICE_DEADLINES;
  await assert.rejects(f.open({replacesAttemptId:first.attemptId}),/voice_connection_deadline_unavailable/);
  assert.equal(f.calls.length,1);assert.equal((await f.controls()).current_attempt_id,first.attemptId);
  assert.equal((await f.user()).free_session_used,1);
});

for(const status of [400,503]) test('provider failure spends no credit and releases no answer: '+status,async t=>{
  const f=fixture(t);f.setHandler(async()=>new Response('private diagnostic',{status}));
  await assert.rejects(f.open(),/voice_call_create_/);
  assert.equal((await f.user()).free_session_used,0);assert.equal((await f.sessions()).length,0);
  if(status===400){f.setHandler(null);assert.equal((await f.open()).mode,'free');}
  else {await assert.rejects(f.open(),/voice_connection_pending/);assert.equal(f.calls.length,1);}
});

test('invalid SDP, absent role, missing owner and paywall dispatch no provider request',async t=>{
  const f=fixture(t);
  await assert.rejects(f.open({sdp:'private invalid'}),/request_invalid/);
  await assert.rejects(f.open({role:''}),/role_required/);
  await assert.rejects(f.open({uid:'absent'}),/owner_missing/);
  f.db.exec("UPDATE users SET free_session_used=1 WHERE auth_id='owner'");
  await assert.rejects(f.open(),/paywall|free_used/);assert.equal(f.calls.length,0);
});

test('End arriving before start prevents any later provider request or credit reservation',async t=>{
  const f=fixture(t);assert.deepEqual(await f.close(),{closed:true});
  await assert.rejects(f.open(),/ended/);assert.equal(f.calls.length,0);assert.equal((await f.user()).free_session_used,0);
});

test('End while provider creation is delayed persists intent and closes the late call without charging',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred();
  f.setHandler(async({url})=>{
    if(url.endsWith('/hangup'))return new Response(null,{status:200});
    entered.resolve();await release.promise;return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_late'}});
  });
  const starting=f.open();await entered.promise;assert.deepEqual(await f.close(),{closed:false});
  release.resolve();await assert.rejects(starting,/reservation_unavailable|ended/);
  assert.equal((await f.user()).free_session_used,0);assert.equal((await f.sessions()).length,0);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/hangup')).length,1);
  assert.deepEqual(await f.close(),{closed:true});await assert.rejects(f.open(),/ended/);
});

test('deletion intent during setup withholds SDP and consumes no interview',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred();
  f.setHandler(async({url})=>{
    if(url.endsWith('/hangup'))return new Response(null,{status:200});
    entered.resolve();await release.promise;return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_deleting'}});
  });
  const starting=f.open();await entered.promise;await beginDeletionAdmission(f.env,{uid:'owner',origin:'user_request'});
  release.resolve();await assert.rejects(starting,/reservation_unavailable/);
  assert.equal((await f.user()).free_session_used,0);assert.equal((await f.sessions()).length,0);assert.equal(f.calls.length,2);
});

test('a reconnect closes exactly the previous owned call and keeps the same credit and deadline',async t=>{
  const f=fixture(t),first=await f.open();
  const resumed=await f.open({replacesAttemptId:first.attemptId,interviewStarted:true,
    transcript:[{speaker:'user',text:'I improved an onboarding process.'}]});
  assert.equal(resumed.resumed,true);assert.notEqual(resumed.attemptId,first.attemptId);assert.equal(resumed.deadlineAt,first.deadlineAt);
  assert.equal((await f.user()).free_session_used,1);assert.equal((await f.sessions()).length,1);assert.equal(f.calls.length,3);
  assert.ok(f.calls[1].url.endsWith('/rtc_1/hangup'));
  assert.match(JSON.parse(f.calls[2].init.body.get('session')).instructions,/RESUMING/);
  await assert.rejects(f.open({replacesAttemptId:first.attemptId}),e=>e.message==='voice_connection_conflict' && e.currentAttemptId===resumed.attemptId);
  assert.equal(f.calls.length,3,'stale reconnect cannot hang up the replacement');
});

test('lost success response is recoverable by the same session ID without another entitlement',async t=>{
  const f=fixture(t),first=await f.open();let current;
  await assert.rejects(f.open(),e=>{current=e.currentAttemptId;return e.message==='voice_connection_conflict';});
  assert.equal(current,first.attemptId);assert.equal((await f.open({replacesAttemptId:current})).resumed,true);
  assert.equal((await f.sessions()).length,1);assert.equal((await f.user()).free_session_used,1);
});

test('competing starts of the same interview create only one provider call and reservation',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred();
  f.setHandler(async()=>{entered.resolve();await release.promise;return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_only'}});});
  const first=f.open();await entered.promise;await assert.rejects(f.open(),/connection_pending/);
  release.resolve();await first;assert.equal(f.calls.length,1);assert.equal((await f.sessions()).length,1);
});

test('two different interviews racing for the last credit close the losing provider call',async t=>{
  const f=fixture(t),both=deferred();let creates=0;
  f.setHandler(async({url})=>{
    if(url.endsWith('/hangup'))return new Response(null,{status:200});
    const number=++creates;if(creates===2)both.resolve();await both.promise;
    return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_'+number}});
  });
  const results=await Promise.allSettled([f.open(),f.open({sessionId:SECOND})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.sessions()).length,1);
  assert.equal((await f.user()).free_session_used,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/hangup')).length,1);
});

test('lost reservation receipt preserves the committed credit and resumes its existing row',async t=>{
  const f=fixture(t),batch=f.db.batch;let lose=true;
  f.db.batch=async statements=>{const result=await batch(statements);if(lose){lose=false;throw Error('fixture lost DB receipt');}return result;};
  await assert.rejects(f.open(),/connection_unconfirmed/);assert.equal((await f.sessions()).length,1);
  assert.equal((await f.user()).free_session_used,1);assert.equal((await f.open()).resumed,true);
  assert.equal((await f.sessions()).length,1);assert.equal((await f.user()).free_session_used,1);
});

test('failed reservation rolls back credit and closes the provider call before a fresh retry',async t=>{
  const f=fixture(t);f.db.exec("CREATE TRIGGER fail_reserve BEFORE INSERT ON voice_sessions BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;");
  await assert.rejects(f.open(),/connection_unconfirmed/);assert.equal((await f.user()).free_session_used,0);
  assert.equal((await f.sessions()).length,0);assert.equal(f.calls.length,2);
  f.db.exec('DROP TRIGGER fail_reserve');assert.equal((await f.open()).resumed,false);
});

test('another account cannot adopt or end an owned interview or pending start',async t=>{
  const f=fixture(t),first=await f.open();
  await assert.rejects(f.open({uid:'other',replacesAttemptId:first.attemptId}),/not_found/);
  await assert.rejects(closeManagedInterview(f.env,{uid:'other',sessionId:FIRST}),/not_found/);
  await closeManagedInterview(f.env,{uid:'other',sessionId:SECOND});
  f.db.exec("UPDATE users SET voice_sessions_remaining=1 WHERE auth_id='owner'");
  await assert.rejects(f.open({sessionId:SECOND}),/not_admitted/);assert.equal(f.calls.length,1);
});

test('legacy untracked sessions cannot silently bypass call ownership during reconnect',async t=>{
  const f=fixture(t);f.db.prepare("INSERT INTO voice_sessions(id,user_id,status,role) VALUES(?,1,'active','Engineer')").bind(FIRST).run();
  await assert.rejects(f.open(),/legacy_session/);assert.equal(f.calls.length,0);
});

test('a deadline passed during setup prevents reservation and reconnect cannot extend it',async t=>{
  const f=fixture(t);f.setHandler(async({url})=>{
    if(url.endsWith('/hangup'))return new Response(null,{status:200});
    f.db.exec("UPDATE voice_interview_controls SET deadline_at=datetime('now','-1 second')");
    return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_expired'}});
  });
  await assert.rejects(f.open(),/reservation_unavailable/);assert.equal((await f.user()).free_session_used,0);
  await assert.rejects(f.open(),/expired/);assert.equal(f.calls.length,2);
});

test('completion before reconnect forbids reopening; unknown hangup never becomes a successful close',async t=>{
  const f=fixture(t),first=await f.open();
  f.setHandler(async()=>new Response(null,{status:404}));
  assert.deepEqual(await f.close(),{closed:false});assert.deepEqual(await f.close(),{closed:false});
  await assert.rejects(f.open({replacesAttemptId:first.attemptId}),/ended/);assert.equal(f.calls.length,2);
  assert.equal((await f.sessions()).length,1,'the transport helper does not overwrite the transcript or delete history');
});

test('legacy closure uncertainty persists across retry and still prevents account erasure',async t=>{
  const f=fixture(t);await f.db.prepare("INSERT INTO voice_sessions(id,user_id,status,role) VALUES(?,1,'active','Engineer')").bind(FIRST).run();
  assert.deepEqual(await f.close(),{closed:false});assert.deepEqual(await f.close(),{closed:false});
  await beginDeletionAdmission(f.env,{uid:'owner',origin:'user_request'});
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/deletion_voice_pending/);
  assert.equal(f.calls.length,0);
});

test('erased history cannot turn a retry into a second credit reservation',async t=>{
  const f=fixture(t);f.db.exec("UPDATE users SET voice_sessions_remaining=2 WHERE auth_id='owner'");
  await f.open();f.db.exec('DELETE FROM voice_sessions');
  await assert.rejects(f.open(),/history_removed/);assert.equal((await f.user()).voice_sessions_remaining,1);
  assert.equal(f.calls.length,1);
});

test('reservation receipt and credit commit atomically',async t=>{
  const f=fixture(t);f.db.exec("CREATE TRIGGER fail_receipt BEFORE UPDATE OF reserved_at ON voice_interview_controls BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END;");
  await assert.rejects(f.open(),/connection_unconfirmed/);
  assert.equal((await f.user()).free_session_used,0);assert.equal((await f.sessions()).length,0);
  assert.equal(f.calls.length,2);assert.equal((await f.controls()).reserved_at,null);
});

test('subscription allowance survives history deletion and the same reservation is counted once',async t=>{
  const f=fixture(t);f.env.VOICE_FAIR_USE_CAP='2';
  f.db.exec("UPDATE users SET plan='monthly',subscription_status='active',current_period_end=datetime('now','+1 month') WHERE auth_id='owner'");
  const first=await f.open();assert.equal(first.mode,'subscription');await f.close();
  assert.equal((await f.open({sessionId:SECOND})).mode,'subscription','retained row and its receipt count once');
  f.db.exec('DELETE FROM voice_sessions');
  await assert.rejects(f.open({sessionId:'33333333-3333-4333-8333-333333333333'}),/limit_reached/);
  assert.equal(f.calls.length,3,'clearing history does not authorize another provider call');
});

test('subscription cancellation during provider setup prevents stale paid access from reserving a session',async t=>{
  const f=fixture(t);f.db.exec("UPDATE users SET plan='monthly',subscription_status='active',current_period_end=datetime('now','+1 month') WHERE auth_id='owner'");
  f.setHandler(async({url})=>{
    if(url.endsWith('/hangup'))return new Response(null,{status:200});
    f.db.exec("UPDATE users SET subscription_status='canceled' WHERE auth_id='owner'");
    return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_canceled'}});
  });
  await assert.rejects(f.open(),/reservation_unavailable/);assert.equal((await f.sessions()).length,0);
  assert.equal((await f.controls()).reserved_at,null);assert.equal(f.calls.length,2);
});

const routeUrl=new URL('../../api/voice/connection.js',import.meta.url);
const routeSource=readFileSync(routeUrl,'utf8').replace(/from '([^']+)'/g,(_,path)=>{
  if(path.endsWith('/firebase-auth.js')) return "from 'data:text/javascript;base64,"+Buffer.from(`
    export const getBearer=r=>r.headers.get('Authorization');
    export const verifyFirebaseIdToken=async token=>{if(token!=='valid')throw Error('private auth failure');return {uid:'owner',payload:{name:'Pat',email:'owner@example.test'}};};
  `).toString('base64')+"'";
  return `from '${new URL(path,routeUrl).href}'`;
});
const route=(await import('data:text/javascript;base64,'+Buffer.from(routeSource).toString('base64'))).onRequest;
function requestContext(f,body,{token='valid',signal}={}) {
  const waits=[];
  const context={env:f.env,data:{},waitUntil(p){waits.push(p);void p.catch(()=>{});},request:new Request('https://qa.jobhackai.io/api/voice/connection',
    {method:'POST',headers:{Authorization:token,Origin:'https://qa.jobhackai.io','Content-Type':'application/json'},body:JSON.stringify(body),signal})};
  return {context,waits,flush:async()=>{let offset=0;while(offset<waits.length){const pending=waits.slice(offset);offset=waits.length;await Promise.allSettled(pending);}}};
}
const openBody={action:'open',sessionId:FIRST,sdp:SDP,role:'Engineer'};

test('real connection route authenticates ownership, returns only an SDP answer and exposes a recoverable conflict',async t=>{
  const f=fixture(t);
  const invalid=requestContext(f,openBody,{token:'invalid'});assert.equal((await route(invalid.context)).status,401);assert.equal(f.calls.length,0);
  const first=requestContext(f,{...openBody,uid:'other',providerCallId:'rtc_foreign'});
  const response=await route(first.context),payload=await response.json();await first.flush();
  assert.equal(response.status,200);assert.equal(payload.sdp,SDP);assert.equal(payload.clientSecret,undefined);assert.equal(payload.providerCallId,undefined);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal((await f.sessions())[0].user_id,1);
  const retry=requestContext(f,openBody);const conflict=await route(retry.context);const error=await conflict.json();await retry.flush();
  assert.equal(conflict.status,409);assert.equal(error.success,false);assert.equal(error.currentAttemptId,payload.attemptId);assert.equal(f.calls.length,1);
});

test('real route registers provider work before dispatch and retains it after the HTTP signal aborts',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred(),controller=new AbortController();
  const run=requestContext(f,openBody,{signal:controller.signal});
  f.setHandler(async()=>{assert.ok(run.waits.length>0);entered.resolve();await release.promise;return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_registered'}});});
  const response=withAccountOperation(run.context,'owner',()=>route(run.context));await entered.promise;
  controller.abort();assert.equal(await f.db.prepare("SELECT state FROM account_operation_claims WHERE auth_id='owner'").first('state'),'active');
  release.resolve();assert.equal((await response).status,200);await run.flush();
  assert.equal(await f.db.prepare("SELECT state FROM account_operation_claims WHERE auth_id='owner'").first('state'),'finished');
  assert.equal((await f.sessions()).length,1);
});

test('real close route keeps pending creation distinct from confirmed closure and never accepts another owner ID',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred();
  f.setHandler(async({url})=>{if(url.endsWith('/hangup'))return new Response(null,{status:200});entered.resolve();await release.promise;return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_pending'}});});
  const opening=requestContext(f,openBody);const started=route(opening.context);await entered.promise;
  const closing=requestContext(f,{action:'close',sessionId:FIRST,uid:'other'});
  const pending=await route(closing.context);const payload=await pending.json();await closing.flush();
  assert.equal(pending.status,202);assert.equal(payload.connectionClosed,false);assert.equal(payload.sessionReserved,false);
  release.resolve();assert.equal((await started).status,409);await opening.flush();
  const retry=requestContext(f,{action:'close',sessionId:FIRST});const stopped=await route(retry.context);await retry.flush();
  assert.equal(stopped.status,200);assert.equal((await stopped.json()).connectionClosed,true);assert.equal((await f.user()).free_session_used,0);
});

test('connection route rejects oversized/private bodies and can persist End even if its provider key is unavailable',async t=>{
  const f=fixture(t),large=requestContext(f,{...openBody,sdp:'v=0'+'x'.repeat(100001)});
  assert.equal((await route(large.context)).status,413);assert.equal(f.calls.length,0);
  const first=await f.open();delete f.env.OPENAI_API_KEY;
  const closing=requestContext(f,{action:'close',sessionId:FIRST});const result=await route(closing.context);await closing.flush();
  assert.equal(result.status,202);assert.ok((await f.controls()).closed_at);
  await assert.rejects(f.open({replacesAttemptId:first.attemptId}),/ended/);assert.equal(f.calls.length,1);
});

test('the unfinished connection route is dark unless its separate cutover flag is explicitly enabled',async t=>{
  const f=fixture(t);delete f.env.VOICE_MANAGED_CALLS_ENABLED;
  const run=requestContext(f,openBody);assert.equal((await route(run.context)).status,404);
  assert.equal(f.calls.length,0);assert.equal(run.waits.length,0);
});

test('a recorded definite provider rejection does not leave an uncertain account operation or spend credit',async t=>{
  const f=fixture(t);f.setHandler(async()=>new Response('private provider error',{status:400}));
  const run=requestContext(f,openBody);
  const result=await withAccountOperation(run.context,'owner',()=>route(run.context));await run.flush();
  assert.equal(result.status,409);assert.equal((await f.user()).free_session_used,0);
  assert.equal(await f.db.prepare("SELECT state FROM account_operation_claims WHERE auth_id='owner'").first('state'),'finished');
  assert.equal(await f.db.prepare('SELECT state FROM voice_provider_calls').first('state'),'closed');
});

const completeUrl=new URL('../../api/voice/session/[id]/complete.js',import.meta.url);
const completeSource=readFileSync(completeUrl,'utf8').replace(/from '([^']+)'/g,(_,path)=>{
  if(path.endsWith('/firebase-auth.js'))return "from 'data:text/javascript;base64,"+Buffer.from(`export const getBearer=r=>r.headers.get('Authorization'); export const verifyFirebaseIdToken=async t=>{if(t!=='valid')throw Error();return {uid:'owner'};};`).toString('base64')+"'";
  if(path.endsWith('/voice-scorecard.js'))return "from 'data:text/javascript;base64,"+Buffer.from('export async function generateAndStoreScorecard(){return true;}').toString('base64')+"'";
  return `from '${new URL(path,completeUrl).href}'`;
});
const completeRoute=(await import('data:text/javascript;base64,'+Buffer.from(completeSource).toString('base64'))).onRequest;
function completion(f,payload={},sessionId=FIRST) {
  const run=requestContext(f,{reason:'user_ended',transcript:[{speaker:'user',text:'I improved checkout conversion by eighteen percent.'}],durationSeconds:42,...payload});
  run.context.params={id:sessionId};return {...run,execute:()=>completeRoute(run.context)};
}

test('managed completion closes the provider, persists the first transcript and is idempotent',async t=>{
  const f=fixture(t);await f.open();const first=completion(f);const response=await first.execute();await first.flush();
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.saved,true);assert.equal(body.connectionClosed,true);
  const original=(await f.sessions())[0];assert.equal(original.status,'completed');assert.match(original.transcript_json,/eighteen percent/);
  const retry=completion(f,{transcript:[{speaker:'user',text:'Must not replace the first report.'}]});assert.equal((await retry.execute()).status,200);await retry.flush();
  assert.equal((await f.sessions())[0].transcript_json,original.transcript_json);assert.equal(f.calls.length,2);
});

test('completion overtaking setup reports pending, then cancelled without consuming credit',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred();
  f.setHandler(async({url})=>{if(url.endsWith('/hangup'))return new Response(null,{status:200});entered.resolve();await release.promise;return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_overtaken'}});});
  const opening=f.open();await entered.promise;
  const first=completion(f);const pending=await first.execute();await first.flush();
  assert.equal(pending.status,202);assert.deepEqual(Object.fromEntries(Object.entries(await pending.json()).filter(([key])=>['status','saved','connectionClosed'].includes(key))),{status:'ending',saved:false,connectionClosed:false});
  release.resolve();await assert.rejects(opening,/reservation_unavailable/);
  const retry=completion(f);const cancelled=await retry.execute();await retry.flush();
  assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).status,'cancelled');assert.equal((await f.user()).free_session_used,0);
});

test('uncertain hangup does not lose the report or pretend closure succeeded',async t=>{
  const f=fixture(t);await f.open();f.setHandler(async()=>new Response(null,{status:404}));
  const first=completion(f);const response=await first.execute();await first.flush();const payload=await response.json();
  assert.equal(response.status,202);assert.equal(payload.saved,true);assert.equal(payload.connectionClosed,false);assert.equal(payload.status,'completed');
  const original=(await f.sessions())[0].transcript_json;
  const retry=completion(f,{transcript:[]});const again=await retry.execute();await retry.flush();
  assert.equal(again.status,202);assert.equal((await f.sessions())[0].transcript_json,original);assert.equal(f.calls.length,2);
});

test('completion of a legacy session saves its report while preserving unverified call closure',async t=>{
  const f=fixture(t);await f.db.prepare("INSERT INTO voice_sessions(id,user_id,status,role) VALUES(?,1,'active','Engineer')").bind(FIRST).run();
  const run=completion(f);const response=await run.execute();await run.flush();const payload=await response.json();
  assert.equal(response.status,202);assert.equal(payload.saved,true);assert.equal(payload.connectionClosed,false);
  assert.equal((await f.controls()).legacy_unverified,1);assert.equal(f.calls.length,0);
});

test('deleted history is never described as a cancelled uncharged interview',async t=>{
  const f=fixture(t);await f.open();const first=completion(f);await first.execute();await first.flush();
  f.db.exec('DELETE FROM voice_sessions');const retry=completion(f);const response=await retry.execute();await retry.flush();
  assert.equal(response.status,409);assert.equal((await response.json()).reason,'voice_connection_history_removed');assert.equal((await f.user()).free_session_used,1);
});

test('managed completion retains account admission through delayed hangup and report persistence',async t=>{
  const f=fixture(t);await f.open();const entered=deferred(),release=deferred();
  f.setHandler(async()=>{entered.resolve();await release.promise;return new Response(null,{status:200});});
  const run=completion(f);const pending=withAccountOperation(run.context,'owner',()=>run.execute());await entered.promise;
  assert.ok(run.waits.length>0);assert.equal(await f.db.prepare("SELECT state FROM account_operation_claims WHERE auth_id='owner'").first('state'),'active');
  release.resolve();assert.equal((await pending).status,200);await run.flush();
  assert.equal((await f.sessions())[0].status,'completed');assert.equal(await f.db.prepare("SELECT state FROM account_operation_claims WHERE auth_id='owner'").first('state'),'finished');
});

test('another owner cannot use managed completion to close or save a foreign session',async t=>{
  const f=fixture(t);await f.open({uid:'other'});const run=completion(f);const response=await run.execute();await run.flush();
  assert.equal(response.status,404);assert.equal(f.calls.length,1);assert.equal((await f.sessions())[0].status,'created');
});

test('managed entitlement display fails closed when its control schema is missing',async t=>{
  const f=fixture(t);f.db.exec('DROP TABLE voice_interview_controls');
  assert.equal((await getVoiceEntitlement(f.env,'owner',{managed:true})).reason,'not_migrated');
  assert.equal(f.calls.length,0);
});
