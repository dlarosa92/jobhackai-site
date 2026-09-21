import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { createManagedVoiceCall, closeManagedVoiceCall, closeOneVoiceCallForDeletion } from '../voice-provider-calls.js';
import { beginDeletionAdmission, assertDeletionQuiescent, admitAccountOperation } from '../account-deletion-admission.js';
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const SDP='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(t) {
  const db=sqliteD1();t.after(()=>db.close());
  for(const name of ['schema.sql','migrations/028_account_deletion_recovery.sql']) db.exec(readFileSync(new URL('../../../db/'+name,import.meta.url),'utf8'));
  db.exec("INSERT INTO users(id,auth_id,email) VALUES(1,'owner','owner@example.test'),(2,'other','other@example.test')");
  const env={DB:db,OPENAI_API_KEY:'sk-test-private-fixture',ENVIRONMENT:'qa'};
  const calls=[];const realFetch=globalThis.fetch;let handler=null;
  globalThis.fetch=async(url,init)=>{
    const call={url:String(url),init};calls.push(call);
    if(handler)return handler(call);
    return String(url).endsWith('/hangup')?new Response(null,{status:200}):new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_'+calls.length}});
  };
  t.after(()=>{globalThis.fetch=realFetch;});
  return {db,env,calls,setHandler:fn=>{handler=fn;},
    create:(sessionId='interview-1')=>createManagedVoiceCall(env,{uid:'owner',sessionId,sdp:SDP,instructions:'Fixture interview instructions'}),
    row:()=>db.prepare('SELECT * FROM voice_provider_calls ORDER BY created_at,id LIMIT 1').first(),
    intent:()=>beginDeletionAdmission(env,{uid:'owner',origin:'user_request'})};
}

test('provider call ID is durably owned before SDP returns; no reusable secret leaves the server',async t=>{
  const f=fixture(t);let observed;
  f.setHandler(async({url,init})=>{
    observed=await f.row();assert.equal(observed.state,'creating');assert.ok(observed.execution_token);
    assert.equal(url,'https://api.openai.com/v1/realtime/calls');assert.equal(init.redirect,'error');assert.ok(init.signal);
    assert.equal(init.body.get('sdp'),SDP);
    const config=JSON.parse(init.body.get('session'));assert.equal(config.model,'gpt-realtime-mini');assert.equal(config.audio.output.voice,'marin');
    assert.equal(config.instructions,'Fixture interview instructions');
    return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_owned'}});
  });
  const result=await f.create();const row=await f.row();assert.equal(row.state,'active');assert.equal(row.provider_call_id,'rtc_owned');
  assert.equal(row.execution_token,null);assert.equal(row.provider_key_sha256.length,64);assert.equal(result.attemptId,row.id);assert.equal(result.sdp,SDP);
  assert.ok(!JSON.stringify(row).includes('sk-test'));assert.ok(!JSON.stringify(row).includes('Fixture interview'));assert.ok(!JSON.stringify(row).includes('UDP/TLS'));
  assert.deepEqual(Object.keys(result).sort(),['attemptId','sdp']);
});

test('competing creates for the same interview dispatch one provider request',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred();
  f.setHandler(async()=>{entered.resolve();await release.promise;return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_one'}});});
  const first=f.create();await entered.promise;
  await assert.rejects(f.create(),/voice_call_not_admitted/);assert.equal(f.calls.length,1);
  release.resolve();await first;
});

test('deletion and maintenance admission prevent new provider calls',async t=>{
  const f=fixture(t);await admitAccountOperation(f.env,'owner','maintenance');
  await assert.rejects(f.create(),/not_admitted/);assert.equal(f.calls.length,0);
  f.db.exec('DELETE FROM account_operation_claims');await f.intent();
  await assert.rejects(f.create(),/not_admitted/);assert.equal(f.calls.length,0);assert.equal(await f.row(),null);
});

test('a deletion requested during create waits, then closes the recorded call',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred();
  f.setHandler(async({url})=>{
    if(url.endsWith('/hangup'))return new Response(null,{status:200});
    entered.resolve();await release.promise;return new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_race'}});
  });
  const creating=f.create();await entered.promise;await f.intent();
  await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/deletion_voice_pending/);
  assert.deepEqual(await closeOneVoiceCallForDeletion(f.env,'owner'),{closed:false});assert.equal(f.calls.length,1);
  release.resolve();await creating;
  assert.deepEqual(await closeOneVoiceCallForDeletion(f.env,'owner'),{closed:true});await assertDeletionQuiescent(f.env,'owner');
  assert.equal(f.calls.length,2);
});

test('another owner cannot create over a saved interview or close its provider call',async t=>{
  const f=fixture(t);f.db.exec("INSERT INTO voice_sessions(id,user_id,role) VALUES('foreign',2,'Engineer')");
  await assert.rejects(f.create('foreign'),/not_admitted/);assert.equal(f.calls.length,0);
  const created=await f.create();await assert.rejects(closeManagedVoiceCall(f.env,{uid:'other',attemptId:created.attemptId}),/not_found/);
  assert.equal(f.calls.length,1);assert.equal((await f.row()).state,'active');
});

test('changed provider credentials cannot close a call under another key',async t=>{
  const f=fixture(t);const created=await f.create();
  await assert.rejects(closeManagedVoiceCall({...f.env,OPENAI_API_KEY:'sk-other-key'},{uid:'owner',attemptId:created.attemptId}),/provider_changed/);
  assert.equal(f.calls.length,1);assert.equal((await f.row()).state,'active');
});

test('hangup is exclusive and a confirmed close is idempotent',async t=>{
  const f=fixture(t),created=await f.create(),entered=deferred(),release=deferred();
  f.setHandler(async()=>{entered.resolve();await release.promise;return new Response(null,{status:200});});
  const closing=closeManagedVoiceCall(f.env,{uid:'owner',attemptId:created.attemptId});await entered.promise;
  await assert.rejects(closeManagedVoiceCall(f.env,{uid:'owner',attemptId:created.attemptId}),/close_unconfirmed/);
  release.resolve();assert.equal((await closing).closed,true);
  assert.deepEqual(await closeManagedVoiceCall(f.env,{uid:'owner',attemptId:created.attemptId}),{closed:true,alreadyClosed:true});
  assert.equal(f.calls.length,2);assert.equal((await f.row()).state,'closed');
});

for(const scenario of ['timeout','5xx','429','missing_location','foreign_location','query_location','encoded_location']) {
  test('uncertain create is retained without releasing SDP or retrying: '+scenario,async t=>{
    const f=fixture(t);f.setHandler(async()=>{
      if(scenario==='timeout')throw Error('private provider diagnostic');
      const status=scenario==='5xx'?503:scenario==='429'?429:201;
      const location={foreign_location:'https://elsewhere.test/v1/realtime/calls/rtc_other',query_location:'/v1/realtime/calls/rtc_one?x=y',encoded_location:'/v1/realtime/calls/rtc_%2fother'}[scenario];
      return new Response(SDP,{status,headers:location?{Location:location}:{}});
    });
    await assert.rejects(f.create(),{message:'voice_call_create_unconfirmed'});const row=await f.row();
    assert.equal(row.state,'uncertain');assert.ok(row.execution_token);assert.equal(row.provider_call_id,null);
    await assert.rejects(f.create(),/not_admitted/);assert.equal(f.calls.length,1);
    await f.intent();await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/deletion_voice_pending/);
  });
}

test('definite create rejection permits a fresh attempt without pretending a call succeeded',async t=>{
  const f=fixture(t);f.setHandler(async()=>new Response('private rejected payload',{status:400}));
  await assert.rejects(f.create(),/create_rejected/);assert.equal((await f.row()).state,'closed');
  f.setHandler(null);await f.create();assert.equal(f.calls.length,2);
});

test('definite provider rejection remains recoverable from a receipt log when its database write fails',async t=>{
  const f=fixture(t),logs=[];t.mock.method(console,'log',(...entry)=>logs.push(entry));
  f.db.exec("CREATE TRIGGER deny_rejection_receipt BEFORE UPDATE OF state ON voice_provider_calls WHEN NEW.state='closed' BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;");
  f.setHandler(async()=>new Response('private rejection',{status:400,headers:{'x-request-id':'req_fixture_rejected'}}));
  await assert.rejects(f.create(),/create_unconfirmed/);const row=await f.row();assert.equal(row.state,'uncertain');
  const receipt=logs.find(([event])=>event==='[voice-call] provider_rejected')?.[1];
  assert.deepEqual(receipt,{attempt:row.id,execution:row.execution_token,providerCallId:null,providerRequestId:'req_fixture_rejected',status:400});
  assert.equal(JSON.stringify(logs).includes('private rejection'),false);assert.equal(JSON.stringify(logs).includes(f.env.OPENAI_API_KEY),false);
});

test('failed call-ID persistence never releases the answer or retries an unknown create',async t=>{
  const f=fixture(t),logs=[];t.mock.method(console,'log',(...entry)=>logs.push(entry));
  f.setHandler(async()=>new Response(SDP,{status:201,headers:{Location:'/v1/realtime/calls/rtc_recoverable','x-request-id':'req_fixture_create'}}));
  f.db.exec("CREATE TRIGGER deny_call_save BEFORE UPDATE OF state ON voice_provider_calls WHEN NEW.state='active' BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;");
  await assert.rejects(f.create(),/create_unconfirmed/);assert.equal((await f.row()).state,'uncertain');assert.equal(f.calls.length,1);
  await assert.rejects(f.create(),/not_admitted/);assert.equal(f.calls.length,1);
  const receipt=logs.find(([event])=>event==='[voice-call] provider_created')?.[1],row=await f.row();
  assert.deepEqual(receipt,{attempt:row.id,execution:row.execution_token,providerCallId:'rtc_recoverable',providerRequestId:'req_fixture_create',status:201});
  assert.equal(JSON.stringify(logs).includes(SDP),false);assert.equal(JSON.stringify(logs).includes(f.env.OPENAI_API_KEY),false);
});

test('malformed SDP after a recorded call triggers hangup of that exact owned call',async t=>{
  const f=fixture(t);f.setHandler(async({url})=>url.endsWith('/hangup')?new Response(null,{status:200}):new Response('bad SDP',{status:201,headers:{Location:'/v1/realtime/calls/rtc_bad_answer'}}));
  await assert.rejects(f.create(),/create_unconfirmed/);assert.equal(f.calls.length,2);
  assert.equal(f.calls[1].url,'https://api.openai.com/v1/realtime/calls/rtc_bad_answer/hangup');assert.equal((await f.row()).state,'closed');
});

for(const outcome of ['404','timeout','receipt_failure']) {
  test('unconfirmed hangup holds deletion without repeated provider calls: '+outcome,async t=>{
    const f=fixture(t),logs=[];t.mock.method(console,'log',(...entry)=>logs.push(entry));const created=await f.create();
    if(outcome==='receipt_failure')f.db.exec("CREATE TRIGGER deny_close_receipt BEFORE UPDATE OF state ON voice_provider_calls WHEN NEW.state='closed' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END;");
    f.setHandler(async()=>{if(outcome==='timeout')throw Error('private timeout');return new Response(null,{status:outcome==='404'?404:200,headers:{'x-request-id':'req_fixture_close'}});});
    await assert.rejects(closeManagedVoiceCall(f.env,{uid:'owner',attemptId:created.attemptId}),/close_unconfirmed/);
    const row=await f.row();assert.equal(row.state,'uncertain');assert.ok(row.execution_token);assert.ok(row.provider_call_id);
    await f.intent();assert.deepEqual(await closeOneVoiceCallForDeletion(f.env,'owner'),{closed:false});
    await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/deletion_voice_pending/);assert.equal(f.calls.length,2);
    const receipts=logs.filter(([event])=>event==='[voice-call] provider_closed');assert.equal(receipts.length,outcome==='receipt_failure'?1:0);
    if(outcome==='receipt_failure')assert.deepEqual(receipts[0][1],{attempt:row.id,execution:row.execution_token,providerCallId:row.provider_call_id,providerRequestId:'req_fixture_close',status:200});
  });
}

test('removing local history cannot hide an unresolved provider call',async t=>{
  const f=fixture(t);await f.create();f.db.exec("DELETE FROM voice_sessions;DELETE FROM users WHERE auth_id='owner'");
  assert.equal((await f.row()).state,'active');await f.intent();await assert.rejects(assertDeletionQuiescent(f.env,'owner'),/deletion_voice_pending/);
});

test('each deletion retry closes at most one provider call',async t=>{
  const f=fixture(t);await f.create('first');await f.create('second');await f.intent();
  assert.deepEqual(await closeOneVoiceCallForDeletion(f.env,'owner'),{closed:false});assert.equal(f.calls.length,3);
  assert.deepEqual(await closeOneVoiceCallForDeletion(f.env,'owner'),{closed:true});assert.equal(f.calls.length,4);
  await assertDeletionQuiescent(f.env,'owner');
});

for (const [scenario, expected] of [
  ['rate_limit','create_http_429'], ['server_error','create_http_503'],
  ['missing_reference','create_reference_missing'], ['invalid_reference','create_reference_invalid'],
  ['network','create_transport_unconfirmed']
]) {
  test('private failure diagnosis survives without weakening the hold: '+scenario, async t=>{
    const f=fixture(t),logs=[];t.mock.method(console,'log',(...entry)=>logs.push(entry));
    f.setHandler(async()=>{
      if(scenario==='network')throw Error('SECRET diagnostic '+f.env.OPENAI_API_KEY);
      const status=scenario==='rate_limit'?429:scenario==='server_error'?503:201;
      return new Response('SECRET provider body',{status,headers:{
        'x-request-id':'req_safe_diagnostic',
        ...(scenario==='invalid_reference'?{Location:'https://foreign.test/SECRET-location'}:{})
      }});
    });
    await assert.rejects(f.create(),{message:'voice_call_create_unconfirmed'});
    const row=await f.row();assert.equal(row.last_error_code,expected);assert.equal(row.state,'uncertain');
    assert.ok(row.execution_token);assert.equal(row.provider_call_id,null);
    await assert.rejects(f.create(),/not_admitted/);assert.equal(f.calls.length,1);
    const diagnostic=logs.find(([event])=>event==='[voice-call] create_failed')?.[1];
    assert.equal(diagnostic.diagnostic,expected);
    const receipt=logs.find(([event])=>/provider_(response|reference)_unconfirmed/.test(event))?.[1];
    if(scenario!=='network')assert.equal(receipt.providerRequestId,'req_safe_diagnostic');
    assert.doesNotMatch(JSON.stringify(logs),/SECRET|sk-test|UDP\/TLS/);
  });
}
