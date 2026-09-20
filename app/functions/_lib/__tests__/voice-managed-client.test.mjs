import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceClientHarness, PLAN_PAYLOAD, scoredSessionPayload } from './helpers/voice-client-harness.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const mic=()=>{const track={enabled:true,stop(){this.enabled=false;}};return {track,getTracks:()=>[track],getAudioTracks:()=>[track]};};
function fixture(t,options={}) {
  let opened=0;
  const deadlineAt=new Date(Date.now()+20*60*1000).toISOString();
  const answer=body=>({sessionId:body.sessionId,attemptId:'attempt-'+(++opened),sdp:'v=0 answer',
    model:'gpt-realtime-mini',mode:'subscription',maxMinutes:20,deadlineAt});
  const routes={
    '/api/plan/me':()=>({...PLAN_PAYLOAD,voice:{...PLAN_PAYLOAD.voice,transport:'managed'}}),
    '/api/voice/sessions':()=>({sessions:[]}),
    '/api/voice/session/':url=>url.includes('/complete')?{status:'completed',saved:true,connectionClosed:true}:{scorecardReady:false},
    '/api/voice/connection':(url,init)=>{
      const body=JSON.parse(init.body);
      return body.action==='close'?{connectionClosed:true,sessionReserved:true}:answer(body);
    },...options.routes
  };
  const h=createVoiceClientHarness({...options,routes});t.after(()=>h.dispose());
  return {h,answer,opens:()=>h.requests.filter(r=>r.url==='/api/voice/connection' && r.body.action==='open'),
    closes:()=>h.requests.filter(r=>r.url==='/api/voice/connection' && r.body.action==='close'),
    start:async()=>{await h.ready();h.el('vi-role').value='Engineer';await h.click('vi-start-btn');}};
}
async function live(f) {
  await f.start();await f.h.openDataChannel();
  const h=f.h;
  h.event({type:'response.created',response:{id:'greet'}});
  h.event({type:'conversation.item.created',item:{id:'greeting'}});
  h.event({type:'response.output_audio_transcript.done',item_id:'greeting',response_id:'greet',transcript:'Before we begin, can you hear me clearly?'});
  h.event({type:'response.done',response:{id:'greet'}});
  h.event({type:'conversation.item.created',item:{id:'ack'}});
  h.event({type:'input_audio_buffer.committed',item_id:'ack'});
  h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'ack',transcript:'Yes, I can hear you fine.'});
  h.event({type:'response.created',response:{id:'opening'}});
  h.event({type:'conversation.item.created',item:{id:'question'}});
  h.event({type:'response.output_audio_transcript.done',item_id:'question',response_id:'opening',transcript:'Welcome to the interview. Tell me about a project you led.'});
  h.event({type:'response.done',response:{id:'opening'}});
  h.event({type:'conversation.item.created',item:{id:'answer'}});
  h.event({type:'input_audio_buffer.committed',item_id:'answer'});
  h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'answer',transcript:'I led a checkout improvement and reduced abandoned purchases by eighteen percent.'});
  await h.settle();
}

test('managed browser sends its SDP to the authenticated app, never mints or uses a provider credential',async t=>{
  const f=fixture(t);await f.start();await f.h.openDataChannel();
  assert.equal(f.opens().length,1);assert.equal(f.opens()[0].body.sdp,'v=0 offer');
  assert.match(f.opens()[0].body.sessionId,/^[a-f0-9-]{36}$/);assert.equal(f.opens()[0].body.replacesAttemptId,null);
  assert.equal(f.h.requests.filter(r=>r.url==='/api/voice/session' || r.url.includes('api.openai.com')).length,0);
  assert.equal(f.h.peerConnection().remoteDescription.sdp,'v=0 answer');
});

test('denied microphone permission performs no setup or credit request and allows retry',async t=>{
  const f=fixture(t,{getUserMedia:async()=>{throw Error('denied');}});await f.start();
  assert.equal(f.opens().length,0);assert.equal(f.h.el('vi-start-btn').disabled,false);assert.equal(f.h.el('vi-setup-view').style.display,'');
});

test('End while microphone permission is pending records closure and never attaches the late stream',async t=>{
  const permission=deferred(),stream=mic();
  const f=fixture(t,{getUserMedia:()=>permission.promise,routes:{
    '/api/voice/session/':()=>({status:'cancelled',saved:false,connectionClosed:true})
  }});
  await f.h.ready();f.h.el('vi-role').value='Engineer';const starting=f.h.click('vi-start-btn');await f.h.settle();
  await f.h.click('vi-end-btn');permission.resolve(stream);await starting;
  assert.equal(stream.track.enabled,false);assert.equal(f.opens().length,0);assert.equal(f.closes().length,1);
  assert.equal(f.h.peerConnection(),null);assert.match(f.h.el('vi-done-status').textContent,/No interview credit was used/);
  assert.equal(f.h.requests.filter(r=>r.method==='GET' && r.url.includes('/api/voice/session/')).length,0);
});

test('End aborts a pending managed SDP exchange and ignores a successful late answer',async t=>{
  const answer=deferred();let body;
  const f=fixture(t,{routes:{'/api/voice/connection':(url,init)=>{
    const data=JSON.parse(init.body);if(data.action==='close')return {connectionClosed:false};body=data;return answer.promise;
  },'/api/voice/session/':()=>({__status:202,status:'ending',saved:false,connectionClosed:false})}});
  await f.h.ready();f.h.el('vi-role').value='Engineer';const starting=f.h.click('vi-start-btn');await f.h.settle();
  const pc=f.h.peerConnection();await f.h.click('vi-end-btn');answer.resolve(f.answer(body));await starting;
  assert.equal(f.opens()[0].signal.aborted,true);assert.equal(pc.remoteDescription,undefined);
  assert.equal(pc.connectionState,'closed');assert.ok(pc.tracks.every(track=>!track.enabled));
  assert.match(f.h.el('vi-save-status').textContent,/still pending/);assert.equal(f.h.el('vi-save-retry').style.display,'');
  assert.equal(f.h.logs.filter(l=>l[0]==='alert').length,0);
});

test('managed reconnect carries the expected attempt and transcript without starting another interview',async t=>{
  const f=fixture(t);await live(f);await f.h.click('vi-reconnect-btn');
  assert.equal(f.opens().length,2);assert.equal(f.opens()[1].body.sessionId,f.opens()[0].body.sessionId);
  assert.equal(f.opens()[1].body.replacesAttemptId,'attempt-1');assert.equal(f.opens()[1].body.interviewStarted,true);
  assert.ok(f.opens()[1].body.transcript.some(turn=>turn.text.includes('eighteen percent')));
  assert.equal(f.h.requests.filter(r=>r.url==='/api/voice/session').length,0);
});

test('End during a delayed managed reconnect cannot reopen its new microphone or change the done view',async t=>{
  const answer=deferred();let count=0,body;
  const f=fixture(t,{routes:{'/api/voice/connection':(url,init)=>{
    const data=JSON.parse(init.body);if(data.action==='close')return {connectionClosed:true};
    if(++count===1)return f.answer(data);body=data;return answer.promise;
  }}});
  await live(f);const reconnecting=f.h.click('vi-reconnect-btn');await f.h.settle();
  const pc=f.h.peerConnection();await f.h.click('vi-end-btn');answer.resolve(f.answer(body));await reconnecting;
  assert.equal(pc.remoteDescription,undefined);assert.ok(pc.tracks.every(track=>!track.enabled));
  assert.equal(f.h.el('vi-done-view').style.display,'');assert.equal(f.h.completeBodies().length,1);
});

test('a lost answer keeps the same ID; an owned-attempt conflict requires an explicit retry to replace it',async t=>{
  let attempts=0;
  const f=fixture(t,{routes:{'/api/voice/connection':(url,init)=>{
    const body=JSON.parse(init.body);if(++attempts===1)throw Error('lost response');
    if(attempts===2)return {__status:409,reason:'voice_connection_conflict',currentAttemptId:'owned-first',error:'already open'};
    return f.answer(body);
  }}});
  await f.start();await f.h.click('vi-start-btn');assert.equal(f.opens().length,2,'no blind automatic replacement');
  await f.h.click('vi-start-btn');assert.equal(f.opens().length,3);
  assert.ok(f.opens().every(r=>r.body.sessionId===f.opens()[0].body.sessionId));
  assert.equal(f.opens()[2].body.replacesAttemptId,'owned-first');
});

test('spoken End persists the interview answer and excludes the control utterance in managed mode',async t=>{
  const f=fixture(t);await live(f);
  f.h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'ending',transcript:"I'll end the interview"});
  await f.h.settle(20);
  assert.equal(f.closes().length,1);assert.equal(f.h.completeBodies().length,1);
  assert.ok(f.h.completeBodies()[0].transcript.some(turn=>turn.text.includes('eighteen percent')));
  assert.ok(!f.h.completeBodies()[0].transcript.some(turn=>turn.text.includes("I'll end")));
  assert.equal(f.h.peerConnection().connectionState,'closed');
});

test('an active call waits for its pending transcript before server hangup and keeps its peer until that receipt',async t=>{
  const closed=deferred();
  const f=fixture(t,{routes:{'/api/voice/connection':(url,init)=>{
    const body=JSON.parse(init.body);return body.action==='close'?closed.promise:f.answer(body);
  }}});
  await live(f);f.h.event({type:'conversation.item.created',item:{id:'late'}});
  f.h.event({type:'input_audio_buffer.committed',item_id:'late'});
  const ending=f.h.click('vi-end-btn');await f.h.settle();assert.equal(f.closes().length,0);
  f.h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'late',transcript:'The team sustained a reduction in support tickets.'});
  await f.h.settle();assert.equal(f.closes().length,1);assert.notEqual(f.h.peerConnection().connectionState,'closed');
  assert.ok(f.h.peerConnection().tracks.every(track=>!track.enabled));
  closed.resolve({connectionClosed:true});await ending;await f.h.settle(20);
  assert.equal(f.h.peerConnection().connectionState,'closed');assert.ok(f.h.completeBodies()[0].transcript.some(turn=>turn.text.includes('support tickets')));
});

test('saved transcript with uncertain closure keeps an exact retry payload and does not claim completion',async t=>{
  let attempts=0;
  const f=fixture(t,{routes:{'/api/voice/session/':url=>url.includes('/complete')
    ? (++attempts===1?{__status:202,status:'completed',saved:true,connectionClosed:false}:{status:'completed',saved:true,connectionClosed:true})
    : {scorecardReady:false}}});
  await live(f);await f.h.click('vi-end-btn');
  assert.match(f.h.el('vi-save-status').textContent,/Interview saved.*needs confirmation/);
  assert.equal(f.h.requests.filter(r=>r.method==='GET' && r.url.includes('/api/voice/session/')).length,0);
  await f.h.click('vi-save-retry');assert.deepEqual(f.h.completeBodies()[0],f.h.completeBodies()[1]);
  assert.equal(f.h.el('vi-save-status').textContent,'');assert.match(f.h.el('vi-done-status').textContent,/Interview saved/);
});

test('a later network failure cannot relabel an acknowledged transcript as unsaved',async t=>{
  let attempts=0;
  const f=fixture(t,{routes:{'/api/voice/session/':()=>++attempts===1
    ? {__status:202,status:'completed',saved:true,connectionClosed:false}:{__status:500,error:'temporary'}}});
  await live(f);await f.h.click('vi-end-btn');await f.h.click('vi-save-retry');
  assert.match(f.h.el('vi-save-status').textContent,/Your interview is saved/);assert.doesNotMatch(f.h.el('vi-save-status').textContent,/not been saved/);
});

test('starting a managed connection warns before tab close, even before WebRTC becomes connected',async t=>{
  const permission=deferred(),stream=mic();const f=fixture(t,{getUserMedia:()=>permission.promise});
  await f.h.ready();f.h.el('vi-role').value='Engineer';const starting=f.h.click('vi-start-btn');await f.h.settle();
  let prevented=false;const event={preventDefault(){prevented=true;},returnValue:undefined};f.h.windowEvent('beforeunload',event);
  assert.equal(prevented,true);await f.h.click('vi-end-btn');permission.resolve(stream);await starting;
});

test('an acknowledged report remains available while call closure is separately pending',async t=>{
  const f=fixture(t,{timerDelay:ms=>ms===2500?0:ms,routes:{'/api/voice/session/':url=>url.includes('/complete')
    ? {__status:202,status:'completed',saved:true,connectionClosed:false}:scoredSessionPayload()}});
  await live(f);await f.h.click('vi-end-btn');await new Promise(resolve=>setTimeout(resolve,10));await f.h.settle();
  assert.ok(f.h.requests.some(r=>r.method==='GET' && r.url.includes('/api/voice/session/')));
  assert.match(f.h.el('vi-scorecard').innerHTML,/Your interview report/);
  assert.match(f.h.el('vi-save-status').textContent,/Connection closure still needs confirmation/);
  assert.equal(f.h.el('vi-save-retry').style.display,'');
});
