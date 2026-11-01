import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceClientHarness, PLAN_PAYLOAD, scoredSessionPayload } from './helpers/voice-client-harness.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
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

for (const [reason,entReason,message] of [
  ['voice_connection_paywall','paywall',/^You have no voice interviews left\. See plans/],
  ['voice_connection_limit_reached','limit_reached',/this month's session limit/]]) {
  test('a managed '+reason+' 403 shows the paywall message and keeps Start disabled',async t=>{
    let plans=0;
    const f=fixture(t,{routes:{
      '/api/plan/me':()=>({voice:{...PLAN_PAYLOAD.voice,transport:'managed',...(++plans>1?{canStart:false,reason:entReason}:{})}}),
      '/api/voice/connection':()=>({__status:403,error:'No interview sessions are available.',reason})}});
    await f.start();
    const alerts=f.h.logs.filter(l=>l[0]==='alert').map(l=>l[1]);
    assert.equal(plans,2);assert.equal(alerts.length,1);assert.match(alerts[0],message);
    assert.doesNotMatch(alerts[0],/Could not connect/);
    assert.equal(f.h.el('vi-start-btn').disabled,true);assert.equal(f.h.el('vi-setup-view').style.display,'');
  });
}

test('End while microphone permission is pending records closure and never attaches the late stream',async t=>{
  const permission=deferred(),stream=mic();
  const f=fixture(t,{getUserMedia:()=>permission.promise,routes:{
    '/api/voice/session/':()=>({status:'cancelled',saved:false,connectionClosed:true})
  }});
  await f.h.ready();f.h.el('vi-role').value='Engineer';const starting=f.h.click('vi-start-btn');await f.h.settle();
  await f.h.endInterview();permission.resolve(stream);await starting;
  assert.equal(stream.track.enabled,false);assert.equal(f.opens().length,0);assert.equal(f.closes().length,1);
  assert.equal(f.closes()[0].body.flushTranscript,false);
  assert.equal(f.h.peerConnection(),null);assert.match(f.h.el('vi-done-status').textContent,/No interview credit was used/);
  assert.equal(f.h.requests.filter(r=>r.method==='GET' && r.url.includes('/api/voice/session/')).length,0);
});

test('End aborts a pending managed SDP exchange and ignores a successful late answer',async t=>{
  const answer=deferred();let body;
  const f=fixture(t,{routes:{'/api/voice/connection':(url,init)=>{
    const data=JSON.parse(init.body);if(data.action==='close')return {connectionClosed:false};body=data;return answer.promise;
  },'/api/voice/session/':()=>({__status:202,status:'ending',saved:false,connectionClosed:false})}});
  await f.h.ready();f.h.el('vi-role').value='Engineer';const starting=f.h.click('vi-start-btn');await f.h.settle();
  const pc=f.h.peerConnection();await f.h.endInterview();answer.resolve(f.answer(body));await starting;
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
  const pc=f.h.peerConnection();await f.h.endInterview();answer.resolve(f.answer(body));await reconnecting;
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

test('an active call records End before transcript flush and keeps its peer until hangup receipt',async t=>{
  const closed=deferred();
  const f=fixture(t,{routes:{'/api/voice/connection':(url,init)=>{
    const body=JSON.parse(init.body);return body.action==='close'?closed.promise:f.answer(body);
  }}});
  await live(f);f.h.event({type:'conversation.item.created',item:{id:'late'}});
  f.h.event({type:'input_audio_buffer.committed',item_id:'late'});
  await f.h.click('vi-end-btn');const ending=f.h.click('vi-end-confirm-btn');await f.h.settle();assert.equal(f.closes().length,1);
  assert.equal(f.closes()[0].body.flushTranscript,true);
  assert.equal(f.h.completeBodies().length,0);
  f.h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'late',transcript:'The team sustained a reduction in support tickets.'});
  await f.h.settle();assert.equal(f.closes().length,1);assert.notEqual(f.h.peerConnection().connectionState,'closed');
  assert.ok(f.h.peerConnection().tracks.every(track=>!track.enabled));
  closed.resolve({connectionClosed:true});await ending;await f.h.settle(20);
  assert.equal(f.h.peerConnection().connectionState,'closed');assert.ok(f.h.completeBodies()[0].transcript.some(turn=>turn.text.includes('support tickets')));
});

test('saved transcript with in-flight closure keeps an exact retry payload and does not claim completion',async t=>{
  let attempts=0;
  const f=fixture(t,{routes:{'/api/voice/session/':url=>url.includes('/complete')
    ? (++attempts===1?{__status:202,status:'completed',saved:true,connectionClosed:false}:{status:'completed',saved:true,connectionClosed:true})
    : {scorecardReady:false}}});
  await live(f);await f.h.endInterview();
  assert.match(f.h.el('vi-save-status').textContent,/Interview saved.*needs confirmation/);
  assert.equal(f.h.requests.filter(r=>r.method==='GET' && r.url.includes('/api/voice/session/')).length,0);
  await f.h.click('vi-save-retry');assert.deepEqual(f.h.completeBodies()[0],f.h.completeBodies()[1]);
  assert.equal(f.h.el('vi-save-status').textContent,'');assert.match(f.h.el('vi-done-status').textContent,/Interview saved/);
});

test('a later network failure cannot relabel an acknowledged transcript as unsaved',async t=>{
  let attempts=0;
  const f=fixture(t,{routes:{'/api/voice/session/':()=>++attempts===1
    ? {__status:202,status:'completed',saved:true,connectionClosed:false}:{__status:500,error:'temporary'}}});
  await live(f);await f.h.endInterview();await f.h.click('vi-save-retry');
  assert.match(f.h.el('vi-save-status').textContent,/Your interview is saved/);assert.doesNotMatch(f.h.el('vi-save-status').textContent,/not been saved/);
});

test('starting a managed connection warns before tab close, even before WebRTC becomes connected',async t=>{
  const permission=deferred(),stream=mic();const f=fixture(t,{getUserMedia:()=>permission.promise});
  await f.h.ready();f.h.el('vi-role').value='Engineer';const starting=f.h.click('vi-start-btn');await f.h.settle();
  let prevented=false;const event={preventDefault(){prevented=true;},returnValue:undefined};f.h.windowEvent('beforeunload',event);
  assert.equal(prevented,true);await f.h.endInterview();permission.resolve(stream);await starting;
});

test('an acknowledged report remains available while call closure is separately pending',async t=>{
  const f=fixture(t,{timerDelay:ms=>ms===2500?0:ms,routes:{'/api/voice/session/':url=>url.includes('/complete')
    ? {__status:202,status:'completed',saved:true,connectionClosed:false}:scoredSessionPayload()}});
  await live(f);await f.h.endInterview();await new Promise(resolve=>setTimeout(resolve,10));await f.h.settle();
  assert.ok(f.h.requests.some(r=>r.method==='GET' && r.url.includes('/api/voice/session/')));
  assert.match(f.h.el('vi-scorecard').innerHTML,/Your practice feedback/);
  assert.match(f.h.el('vi-save-status').textContent,/Connection closure still needs confirmation/);
  assert.equal(f.h.el('vi-save-retry').style.display,'');
});

test('a saved report needing closure review offers no ineffective retry or leave-page warning',async t=>{
  const f=fixture(t,{timerDelay:ms=>ms===2500?0:ms,routes:{'/api/voice/session/':url=>url.includes('/complete')
    ? {__status:202,status:'completed',saved:true,connectionClosed:false,closureNeedsReview:true}:scoredSessionPayload()}});
  await live(f);await f.h.endInterview();await new Promise(resolve=>setTimeout(resolve,10));await f.h.settle();
  assert.match(f.h.el('vi-scorecard').innerHTML,/Your practice feedback/);
  assert.match(f.h.el('vi-save-status').textContent,/interview is saved.*technical review.*can leave/);
  assert.equal(f.h.el('vi-save-retry').style.display,'none');
  assert.equal(f.h.el('vi-save-retry').disabled,true);
  let prevented=false;f.h.windowEvent('beforeunload',{preventDefault(){prevented=true;}});
  assert.equal(prevented,false);
  await f.h.click('vi-save-retry');assert.equal(f.h.completeBodies().length,1);
});

test('an unreserved startup needing closure review never claims a saved report',async t=>{
  const f=fixture(t,{routes:{'/api/voice/session/':()=>({__status:202,status:'ending',saved:false,connectionClosed:false,closureNeedsReview:true})}});
  await f.start();await f.h.endInterview();
  assert.match(f.h.el('vi-save-status').textContent,/No interview was saved.*technical review/);
  assert.equal(f.h.el('vi-save-retry').style.display,'none');
  assert.equal(f.h.requests.filter(r=>r.method==='GET' && r.url.includes('/api/voice/session/')).length,0);
});

for(const reason of ['voice_connection_unconfirmed','voice_connection_pending','voice_call_close_unconfirmed','voice_connection_deadline_unavailable','voice_call_create_rejected']) {
  test('server-side start failure does not blame the microphone: '+reason, async t=>{
    const stream=mic();
    const f=fixture(t,{getUserMedia:async()=>stream,routes:{'/api/voice/connection':()=>({__status:reason==='voice_connection_unconfirmed'?502:409,reason,error:'Connection unavailable'})}});
    await f.start();
    const alerts=f.h.logs.filter(entry=>entry[0]==='alert');assert.equal(alerts.length,1);
    assert.doesNotMatch(String(alerts[0][1]),/microphone|connection, then retry/i);
    assert.equal(stream.track.enabled,false);assert.equal(f.opens().length,1);
    assert.equal(f.h.el('vi-setup-view').style.display,'');
  });
}

test('managed replacement retains the old transport until the server finishes closing its call',async t=>{
  const response=deferred();let count=0,body;
  const f=fixture(t,{routes:{'/api/voice/connection':(url,init)=>{
    const data=JSON.parse(init.body);if(data.action==='close')return {connectionClosed:true};
    if(++count===1)return f.answer(data);body=data;return response.promise;
  }}});
  await live(f);const oldPc=f.h.peerConnection(),oldDc=f.h.dataChannel();
  const replacing=f.h.click('vi-reconnect-btn');await f.h.settle();
  assert.notEqual(oldPc.connectionState,'closed','do not hang up the browser before server closure');
  assert.notEqual(oldDc.readyState,'closed');assert.ok(oldPc.tracks.every(t=>!t.enabled));
  oldPc.connectionState='connected';oldPc.onconnectionstatechange();
  assert.equal(f.h.el('vi-status').textContent,'Reconnecting...','retiring peer cannot overwrite replacement status');
  await f.h.click('vi-reconnect-btn');assert.equal(f.opens().length,2,'duplicate click does not race another replacement');
  response.resolve(f.answer(body));await replacing;
  assert.equal(oldPc.connectionState,'closed');assert.equal(oldDc.readyState,'closed');
  assert.notEqual(f.h.peerConnection(),oldPc);assert.equal(f.opens()[1].body.sessionId,f.opens()[0].body.sessionId);
});

test('a peer that recovers by itself hides Reconnect and cannot be replaced by a stale click',async t=>{
  const f=fixture(t);await live(f);const pc=f.h.peerConnection();
  pc.connectionState='disconnected';pc.onconnectionstatechange();
  assert.equal(f.h.el('vi-reconnect-btn').style.display,'');
  pc.connectionState='connected';pc.onconnectionstatechange();
  assert.equal(f.h.el('vi-reconnect-btn').style.display,'none');
  await f.h.click('vi-reconnect-btn');assert.equal(f.opens().length,1);
  assert.equal(f.h.peerConnection(),pc);assert.notEqual(pc.connectionState,'closed');
});

test('End releases the retained peer even if replacement microphone permission never finishes',async t=>{
  const permission=deferred(),lateMic=mic();let requests=0;
  const f=fixture(t,{getUserMedia:()=>++requests===1?Promise.resolve(mic()):permission.promise});
  await live(f);const oldPc=f.h.peerConnection(),oldDc=f.h.dataChannel();
  const replacing=f.h.click('vi-reconnect-btn');await f.h.settle();
  assert.notEqual(oldPc.connectionState,'closed');
  await f.h.endInterview();assert.equal(oldPc.connectionState,'closed');assert.equal(oldDc.readyState,'closed');
  permission.resolve(lateMic);await replacing;
  assert.equal(lateMic.track.enabled,false);assert.equal(f.opens().length,1);assert.equal(f.closes().length,1);
});

test('unconfirmed replacement closure cleans up both browser transports without another automatic attempt',async t=>{
  const response=deferred();let count=0;
  const f=fixture(t,{routes:{'/api/voice/connection':(url,init)=>{
    const body=JSON.parse(init.body);if(body.action==='close')return {connectionClosed:false};
    return ++count===1?f.answer(body):response.promise;
  },'/api/voice/session/':()=>({__status:202,status:'completed',saved:true,connectionClosed:false,closureNeedsReview:true})}});
  await live(f);const oldPc=f.h.peerConnection();
  const replacing=f.h.click('vi-reconnect-btn');await f.h.settle();const newPc=f.h.peerConnection();
  assert.notEqual(oldPc.connectionState,'closed');
  response.resolve({__status:409,error:'Connection unavailable',reason:'voice_call_close_unconfirmed'});
  await replacing;await f.h.settle(20);
  assert.equal(oldPc.connectionState,'closed');assert.equal(newPc.connectionState,'closed');
  assert.ok(newPc.tracks.every(t=>!t.enabled));assert.equal(f.opens().length,2);
  assert.match(f.h.el('vi-save-status').textContent,/technical review/);
  assert.equal(f.h.el('vi-save-retry').style.display,'none');
  assert.equal(f.h.completeBodies()[0].reason,'connection_lost');
});

// A server deadline `secondsLeft` from now, as the connection route returns it.
function deadlineFixture(t,secondsLeft) {
  const deadlineAt=new Date(Date.now()+secondsLeft*1000).toISOString();
  let f=null;
  f=fixture(t,{routes:{'/api/voice/connection':(url,init)=>{
    const body=JSON.parse(init.body);
    return body.action==='close'?{connectionClosed:true,sessionReserved:true}:{...f.answer(body),deadlineAt};
  }}});
  return f;
}
async function beginInterview(h) {
  h.event({type:'response.created',response:{id:'greet'}});
  h.event({type:'conversation.item.created',item:{id:'greeting'}});
  h.event({type:'response.output_audio_transcript.done',item_id:'greeting',response_id:'greet',transcript:'Before we begin, can you hear me clearly?'});
  h.event({type:'response.done',response:{id:'greet'}});
  h.event({type:'conversation.item.created',item:{id:'ack'}});
  h.event({type:'input_audio_buffer.committed',item_id:'ack'});
  await h.settle();
}

test('the managed countdown follows the server deadline even during the audio check',async t=>{
  // 30 seconds of the server's 20 minutes went to connecting and the audio check.
  const f=deadlineFixture(t,19*60+30);
  await f.start();await f.h.openDataChannel();
  assert.match(f.h.el('vi-timer').textContent,/^19:(29|30)$/,'audio check cannot freeze the actual session clock');
  await beginInterview(f.h);
  assert.match(f.h.el('vi-timer').textContent,/^19:(29|30)$/,'never more time than the server allows');
});

test('two minutes before the server deadline the interviewer is told to wrap up, once',async t=>{
  const f=deadlineFixture(t,100);
  await f.start();await f.h.openDataChannel();
  assert.equal(f.h.el('vi-time-note').style.display,'none','no notice during the audio check');
  await beginInterview(f.h);
  assert.equal(f.h.el('vi-time-note').style.display,'');
  const notices=()=>f.h.sends.filter(s=>s.type==='conversation.item.create' && s.item?.role==='system' && /two minutes remain/i.test(s.item.content[0].text));
  assert.equal(notices().length,1);
  assert.match(notices()[0].item.content[0].text,/two minutes remain/i);
  assert.equal(f.h.analyticsEvents.filter(e=>e.name==='voice_wrap_up_notice').length,1);
  // The system item is announced like any item but never becomes a turn.
  f.h.event({type:'conversation.item.created',item:{id:notices()[0].item.id,type:'message',role:'system'}});
  f.h.event({type:'conversation.item.created',item:{id:'answer'}});
  f.h.event({type:'input_audio_buffer.committed',item_id:'answer'});
  f.h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'answer',transcript:'I led the migration and we shipped it a week early.'});
  await f.h.settle();
  assert.equal(notices().length,1,'the notice is sent once');
  await f.h.endInterview();
  const transcript=f.h.completeBodies()[0].transcript;
  assert.ok(!JSON.stringify(transcript).includes('two minutes'));
  assert.ok(transcript.some(turn=>turn.text.includes('shipped it a week early')));
});

for (const withoutModules of [[],['createInterviewLifecycle']]) {
  test('tagged paraphrased audio check starts the interview and keeps both speakers'+withoutModules.join(),async t=>{
    const f=fixture(t,{withoutModules});await f.start();await f.h.openDataChannel();const h=f.h;
    assert.equal(h.sends.find(e=>e.type==='response.create').response.metadata.jobhackai_purpose,'audio_check');
    h.event({type:'response.created',response:{id:'greet'}});
    h.event({type:'conversation.item.created',item:{id:'greeting',role:'assistant'}});
    h.event({type:'response.output_audio_transcript.delta',item_id:'greeting',response_id:'greet',delta:'How does my audio sound'});
    assert.equal(h.el('vi-question').textContent,'How does my audio sound');
    h.event({type:'response.output_audio_transcript.done',item_id:'greeting',response_id:'greet',transcript:'How does my audio sound today?'});
    h.event({type:'response.done',response:{id:'greet',status:'completed',metadata:{jobhackai_purpose:'audio_check'}}});
    h.event({type:'conversation.item.created',item:{id:'ack',role:'user'}});
    h.event({type:'input_audio_buffer.committed',item_id:'ack'});
    h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'ack',transcript:'Yes, loud and clear.'});
    assert.match(h.el('vi-status').textContent,/Live/);
    assert.equal(h.el('vi-your-answer').textContent,'Yes, loud and clear.');
    h.event({type:'response.created',response:{id:'opening'}});
    h.event({type:'conversation.item.created',item:{id:'question',role:'assistant'}});
    h.event({type:'response.output_audio_transcript.done',item_id:'question',response_id:'opening',transcript:'Tell me about a project you led.'});
    h.event({type:'conversation.item.created',item:{id:'answer',role:'user'}});
    h.event({type:'input_audio_buffer.speech_started',item_id:'answer'});
    assert.match(h.el('vi-input-status').textContent,/Hearing you/);
    h.event({type:'input_audio_buffer.committed',item_id:'answer'});
    h.event({type:'input_audio_buffer.speech_stopped',item_id:'answer'});
    assert.match(h.el('vi-input-status').textContent,/Transcribing/);
    h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'answer',transcript:'I reduced checkout failures by eighteen percent.'});
    assert.match(h.el('vi-your-answer').textContent,/eighteen percent/);
    assert.match(h.el('vi-recent-turns').innerHTML,/Interviewer/);
    assert.match(h.el('vi-recent-turns').innerHTML,/You/);
    assert.match(h.el('vi-recent-turns').innerHTML,/loud and clear/,'setup speech stays visible');
    await h.endInterview();
    const saved=h.completeBodies()[0].transcript;
    assert.equal(saved.length,2);
    assert.match(saved[1].text,/eighteen percent/);
    assert.ok(!JSON.stringify(saved).includes('loud and clear'),'audio-check speech is never scored');
  });
}

test('cancelled paraphrased greeting does not authorize pre-interview speech',async t=>{
  const f=fixture(t);await f.start();await f.h.openDataChannel();const h=f.h;
  h.event({type:'response.output_audio_transcript.done',item_id:'greet',transcript:'How does my audio'});
  h.event({type:'response.done',response:{id:'greet',status:'cancelled',metadata:{jobhackai_purpose:'audio_check'}}});
  h.event({type:'input_audio_buffer.committed',item_id:'early'});
  h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'early',transcript:'I am still checking my microphone.'});
  assert.match(h.el('vi-status').textContent,/audio check/);
  assert.match(h.el('vi-your-answer').textContent,/checking my microphone/);
  await h.endInterview();assert.equal(h.completeBodies()[0].transcript.length,0);
});

for (const result of ['', '   ', null]) {
  test('empty or failed transcription clears its partial caption: '+JSON.stringify(result),async t=>{
    const f=fixture(t);await f.start();await f.h.openDataChannel();const h=f.h;
    h.event({type:'input_audio_buffer.speech_started',item_id:'noise'});
    h.event({type:'conversation.item.input_audio_transcription.delta',item_id:'noise',delta:'unfinished words'});
    h.event({type:'input_audio_buffer.speech_stopped',item_id:'noise'});
    h.event({type:'conversation.item.input_audio_transcription.'+(result===null?'failed':'completed'),item_id:'noise',transcript:result});
    assert.match(h.el('vi-your-answer').textContent,/No words captured/);
    assert.doesNotMatch(h.el('vi-input-status').textContent,/Transcribing/);
    // A replayed delta starts fresh rather than retaining the discarded draft.
    h.event({type:'conversation.item.input_audio_transcription.delta',item_id:'noise',delta:'fresh'});
    assert.equal(h.el('vi-your-answer').textContent,'fresh');
    h.event({type:'input_audio_buffer.speech_started',item_id:'newer'});
    h.event({type:'conversation.item.input_audio_transcription.delta',item_id:'newer',delta:'My next answer'});
    h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'noise',transcript:''});
    assert.equal(h.el('vi-your-answer').textContent,'My next answer','older empty result cannot erase a newer caption');
    await h.endInterview();assert.equal(h.completeBodies()[0].transcript.length,0,'partial and empty text is never scored');
  });
}

function audioFixture(t,options={}) {
  let activations=0, greeting=0;
  const instructions='Audio check passed. Begin the interview with the first question.';
  const f=fixture(t,{...options,routes:{
    '/api/voice/connection':(url,init)=>{
      const body=JSON.parse(init.body);
      if(body.action==='close')return {connectionClosed:true,sessionReserved:activations>0};
      if(body.action==='activate'){
        activations++;
        return {activated:true,sessionId:body.sessionId,attemptId:body.attemptId,deadlineAt:new Date(Date.now()+1200000).toISOString(),instructions};
      }
      return {...f.answer(body),requiresAudioCheck:true,interviewInstructions:instructions,deadlineAt:new Date(Date.now()+120000).toISOString()};
    },
    '/api/voice/session/':()=>({status:'cancelled',saved:false,connectionClosed:true}),
    ...options.routes
  }});
  return {...f,instructions,activations:()=>f.h.requests.filter(r=>r.url==='/api/voice/connection'&&r.body.action==='activate'),
    async check(){await f.start();const pc=f.h.peerConnection();pc.ontrack({streams:[{}],track:{}});await f.h.settle();await f.h.openDataChannel();},
    speech(id='mic-test'){
      f.h.event({type:'conversation.item.created',item:{id,role:'user'}});
      f.h.event({type:'input_audio_buffer.committed',item_id:id});
      f.h.event({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:'Testing my microphone.'});
    },
    async greetingDone(){
      const id='test-greeting-'+(++greeting);
      f.h.event({type:'response.created',response:{id}});
      f.h.event({type:'response.done',response:{id,status:'completed'}});await f.h.settle();
    },
    async acknowledge(){f.h.event({type:'session.updated',session:{instructions}});await f.h.settle();}
  };
}

test('blocked playback and microphone permission alone cannot activate or advance a question',async t=>{
  const f=audioFixture(t);f.h.el('vi-remote-audio').play=async()=>{throw Object.assign(Error('blocked'),{name:'NotAllowedError'});};
  await f.check();f.speech();await f.h.settle();
  assert.equal(f.h.el('vi-audio-confirm').disabled,true);assert.equal(f.h.el('vi-audio-retry').textContent,'Enable audio');
  await f.h.click('vi-audio-confirm');assert.equal(f.activations().length,0);
  assert.equal(f.h.sends.filter(x=>x.type==='response.create'&&x.response.metadata.jobhackai_purpose!=='audio_check').length,0);
  await f.h.endInterview();assert.equal(f.h.completeBodies()[0].transcript.length,0);
  assert.match(f.h.el('vi-done-status').textContent,/No interview credit was used/);
});

test('silent microphone cannot pass readiness even when playback succeeds',async t=>{
  const f=audioFixture(t);await f.check();
  f.h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'silence',transcript:'  '});
  await f.h.click('vi-audio-confirm');assert.equal(f.activations().length,0);assert.equal(f.h.el('vi-audio-confirm').disabled,true);
});

test('click recovery replays the check without consuming a question and activation waits for the exact provider acknowledgement',async t=>{
  const f=audioFixture(t);let blocked=true;
  f.h.el('vi-remote-audio').play=async()=>{if(blocked)throw Error('blocked');};
  await f.check();await f.greetingDone();f.speech();blocked=false;await f.h.click('vi-audio-retry');
  assert.equal(f.h.el('vi-audio-confirm').disabled,false);
  await f.greetingDone();await f.h.click('vi-audio-confirm');await f.h.click('vi-audio-confirm');
  assert.equal(f.activations().length,0,'provider readiness is acknowledged before credit activation');
  assert.equal(f.h.sends.filter(x=>x.type==='response.create'&&x.response.metadata.jobhackai_purpose==='new_topic').length,0);
  f.h.event({type:'session.updated',session:{instructions:'unrelated acknowledgement'}});
  assert.equal(f.h.el('vi-audio-check').hidden,false);
  await f.acknowledge();assert.equal(f.h.el('vi-audio-check').hidden,true);
  assert.equal(f.activations().length,1);assert.equal(f.activations()[0].body.audioReady,true);
  assert.equal(f.activations()[0].body.sessionId,f.opens()[0].body.sessionId);
  const question=f.h.sends.filter(x=>x.type==='response.create'&&x.response.metadata.jobhackai_purpose==='new_topic');
  assert.equal(question.length,1);assert.equal(question[0].response.metadata.jobhackai_topic,'0');
  assert.ok(f.h.sends.some(x=>x.type==='conversation.item.delete'&&x.item_id==='mic-test'));
});

test('late setup transcripts remain excluded after activation and later words are preserved',async t=>{
  const f=audioFixture(t,{routes:{'/api/voice/session/':()=>({status:'completed',saved:true,connectionClosed:true})}});
  await f.check();f.speech();await f.greetingDone();await f.h.click('vi-audio-confirm');await f.acknowledge();
  f.h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'mic-test',transcript:'Late setup words must not be scored.'});
  f.h.event({type:'conversation.item.created',item:{id:'real-answer',role:'user'}});
  f.h.event({type:'input_audio_buffer.committed',item_id:'real-answer'});
  f.h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'real-answer',transcript:'I redesigned our intake process and cut the delay by two days.'});
  await f.h.endInterview();const body=f.h.completeBodies()[0];
  assert.ok(body.transcript.some(x=>x.text.includes('intake process')));
  assert.ok(!body.transcript.some(x=>/Testing|Late setup/.test(x.text)));
});

test('cancel during activation ignores its late success and never requests a question',async t=>{
  const pending=deferred();let activateBody;
  const f=audioFixture(t,{routes:{'/api/voice/connection':(url,init)=>{
    const body=JSON.parse(init.body);if(body.action==='close')return {connectionClosed:true};
    if(body.action==='activate'){activateBody=body;return pending.promise;}
    return {...f.answer(body),requiresAudioCheck:true,interviewInstructions:f.instructions};
  }}});
  await f.check();f.speech();await f.greetingDone();await f.h.click('vi-audio-confirm');await f.acknowledge();
  await f.h.endInterview();pending.resolve({...activateBody,activated:true,instructions:f.instructions,deadlineAt:new Date(Date.now()+1200000).toISOString()});await f.h.settle();
  assert.equal(f.h.peerConnection().connectionState,'closed');
  assert.equal(f.h.sends.filter(x=>x.type==='response.create'&&x.response.metadata.jobhackai_purpose==='new_topic').length,0);
});

test('a missing provider configuration acknowledgement leaves setup uncharged and retryable',async t=>{
  const f=audioFixture(t,{timerDelay:ms=>ms===8000?10:ms});await f.check();f.speech();await f.greetingDone();
  await f.h.click('vi-audio-confirm');await new Promise(resolve=>setTimeout(resolve,25));await f.h.settle();
  assert.equal(f.activations().length,0);assert.equal(f.h.el('vi-audio-confirm').disabled,false);
  assert.match(f.h.el('vi-status').textContent,/No interview has started/);
  await f.h.click('vi-audio-retry');
  const replay=f.h.sends.filter(x=>x.type==='response.create').at(-1);
  assert.equal(replay.response.metadata.jobhackai_purpose,'audio_check');
  assert.match(replay.response.instructions,/Do not ask interview questions/);
  assert.equal(f.activations().length,0);
});

test('audio recovery during the interview neither spends another credit nor advances the question budget',async t=>{
  const f=audioFixture(t);await f.check();f.speech();await f.greetingDone();await f.h.click('vi-audio-confirm');await f.acknowledge();
  f.h.event({type:'response.created',response:{id:'question-one'}});
  f.h.event({type:'response.done',response:{id:'question-one'}});
  await f.h.click('vi-audio-help');
  assert.equal(f.h.el('vi-audio-check').hidden,false);
  await f.h.click('vi-audio-retry');
  assert.equal(f.activations().length,1);assert.equal(f.opens().length,1);
  const turns=f.h.sends.filter(x=>x.type==='response.create').map(x=>x.response.metadata.jobhackai_purpose);
  assert.deepEqual(turns,['audio_check','new_topic','audio_recovery']);
});

test('a muted or disconnected microphone cannot activate, and reconnect rechecks the replacement device',async t=>{
  const streams=[];
  const f=audioFixture(t,{getUserMedia:async()=>{const stream=mic();streams.push(stream);return stream;}});
  await f.check();f.speech();await f.greetingDone();await f.h.click('vi-mute-btn');
  await f.h.click('vi-audio-confirm');assert.equal(f.activations().length,0);assert.equal(f.h.el('vi-audio-confirm').disabled,true);
  await f.h.click('vi-mute-btn');streams[0].track.onended();f.h.peerConnection().connectionState='connected';
  assert.equal(f.h.el('vi-audio-confirm').disabled,true);
  await f.h.click('vi-reconnect-btn');assert.equal(f.opens().length,2);
  assert.equal(f.h.el('vi-audio-confirm').disabled,true,'the old microphone confirmation cannot approve the new device');
  assert.equal(f.activations().length,0);
});

test('microphone loss while configuration is being acknowledged cannot activate an interview',async t=>{
  const stream=mic(),f=audioFixture(t,{getUserMedia:async()=>stream});
  await f.check();f.speech();await f.greetingDone();await f.h.click('vi-audio-confirm');
  stream.track.onended();await f.acknowledge();
  assert.equal(f.activations().length,0);
  assert.equal(f.h.el('vi-audio-confirm').disabled,true);
  assert.match(f.h.el('vi-status').textContent,/Audio changed during setup/);
});

test('a delayed playback rejection cannot undo a newer successful click recovery',async t=>{
  const oldPlay=deferred(),f=audioFixture(t);let plays=0;
  f.h.el('vi-remote-audio').play=()=>++plays===1?oldPlay.promise:Promise.resolve();
  await f.check();f.speech();await f.greetingDone();await f.h.click('vi-audio-retry');
  assert.equal(f.h.el('vi-audio-confirm').disabled,false);
  oldPlay.reject(Error('stale playback failure'));await f.h.settle();
  assert.equal(f.h.el('vi-audio-confirm').disabled,false);
  assert.equal(f.h.el('vi-audio-retry').textContent,'Play again');
  assert.match(f.h.el('vi-status').textContent,/Check your audio before starting/);
});

for (const lost of [false,true]) test('setup expiry cannot close an activation with a '+(lost?'lost':'delayed')+' receipt',async t=>{
  let now=Date.now(),tick,activations=0;
  const pending=deferred();
  const f=audioFixture(t,{Date:class extends Date {static now(){return now;}},onInterval(fn,ms){if(ms===1000)tick=fn;},routes:{
    '/api/voice/connection':(url,init)=>{
      const body=JSON.parse(init.body);
      if(body.action==='close')return {connectionClosed:true};
      if(body.action==='activate'){
        activations++;
        return activations===1?pending.promise:{...body,activated:true,deadlineAt:new Date(now+1200000).toISOString()};
      }
      return {...f.answer(body),requiresAudioCheck:true,interviewInstructions:f.instructions,deadlineAt:new Date(now+120000).toISOString()};
    }
  }});
  await f.check();f.speech();await f.greetingDone();await f.h.click('vi-audio-confirm');await f.acknowledge();
  now+=121000;tick();await f.h.settle();
  assert.equal(f.closes().length,0,'the obsolete setup deadline cannot close a potentially charged interview');
  assert.equal(f.h.completeBodies().length,0);
  if(lost){
    pending.reject(Error('lost response'));await f.h.settle();tick();await f.h.settle();
    assert.equal(f.closes().length,0,'receipt loss also leaves the same interview recoverable');
    assert.match(f.h.el('vi-audio-note').textContent,/recover/i);
    await f.h.click('vi-audio-confirm');await f.acknowledge();
  } else pending.resolve({...f.activations()[0].body,activated:true,deadlineAt:new Date(now+1200000).toISOString()});
  await f.h.settle();tick();await f.h.settle();
  assert.equal(f.h.el('vi-audio-check').hidden,true);
  assert.equal(f.closes().length,0);
  assert.equal(new Set(f.activations().map(x=>x.body.sessionId)).size,1);
  assert.equal(f.h.sends.filter(x=>x.type==='response.create'&&x.response.metadata.jobhackai_purpose==='new_topic').length,1);
});

test('a stalled activation request times out to a retry without closing a potentially committed interview',async t=>{
  const f=audioFixture(t,{timerDelay:ms=>ms===10000?10:ms,routes:{
    '/api/voice/connection':(url,init)=>{
      const body=JSON.parse(init.body);
      if(body.action==='activate')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('timeout'))));
      if(body.action==='close')return {connectionClosed:true};
      return {...f.answer(body),requiresAudioCheck:true,interviewInstructions:f.instructions};
    }
  }});
  await f.check();f.speech();await f.greetingDone();await f.h.click('vi-audio-confirm');await f.acknowledge();
  await new Promise(resolve=>setTimeout(resolve,25));await f.h.settle();
  assert.equal(f.activations()[0].signal.aborted,true);
  assert.equal(f.h.el('vi-audio-confirm').disabled,false);
  assert.equal(f.h.el('vi-audio-confirm').textContent,'Retry start');
  assert.equal(f.closes().length,0);
});

test('a late activation receipt cannot act while reconnect is acquiring a replacement microphone',async t=>{
  let devices=0;const activation=deferred(),permission=deferred();
  const f=audioFixture(t,{getUserMedia:()=>++devices===1?Promise.resolve(mic()):permission.promise,routes:{
    '/api/voice/connection':(url,init)=>{
      const body=JSON.parse(init.body);
      if(body.action==='activate')return activation.promise;
      if(body.action==='close')return {connectionClosed:true};
      return {...f.answer(body),requiresAudioCheck:true,interviewInstructions:f.instructions};
    }
  }});
  await f.check();f.speech();await f.greetingDone();await f.h.click('vi-audio-confirm');await f.acknowledge();
  f.h.peerConnection().connectionState='disconnected';const reconnecting=f.h.click('vi-reconnect-btn');await f.h.settle();
  activation.resolve({...f.activations()[0].body,activated:true,deadlineAt:new Date(Date.now()+1200000).toISOString()});await f.h.settle();
  assert.equal(f.closes().length,0);
  assert.equal(f.h.sends.filter(x=>x.type==='response.create'&&x.response.metadata.jobhackai_purpose==='new_topic').length,0);
  permission.resolve(mic());await reconnecting;
  assert.equal(f.opens().length,2);
});
