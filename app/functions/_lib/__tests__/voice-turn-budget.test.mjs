import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceTurnPlan } from '../../../../js/voice-turn-plan.js';
import { createVoiceClientHarness, PLAN_PAYLOAD, scoredSessionPayload } from './helpers/voice-client-harness.mjs';

const config = { type: 'session.updated', session: { audio: { input: { turn_detection:
  { type: 'semantic_vad', create_response: false, interrupt_response: true } } } } };
async function live(t, options = {}) {
  const h = createVoiceClientHarness({ routes: {
    '/api/plan/me': () => PLAN_PAYLOAD,
    '/api/voice/session/': url => url.includes('/complete') ? { scorecardReady: true } : scoredSessionPayload(),
    '/api/voice/session': () => ({ sessionId:'budget-test',clientSecret:'fixture',maxMinutes:20 }),
    '/realtime/calls': () => ({ __text:'answer-sdp' })
  }, ...options });
  t.after(() => h.dispose());
  await h.ready(); h.el('vi-role').value='Process improvement specialist';
  await h.click('vi-start-btn'); await h.openDataChannel();
  return h;
}
function assistant(h, id, text, status = 'completed') {
  h.event({type:'response.created',response:{id}});
  h.event({type:'conversation.item.created',item:{id:id+'-item',role:'assistant'}});
  h.event({type:'response.output_audio_transcript.done',response_id:id,item_id:id+'-item',transcript:text});
  h.event({type:'response.done',response:{id,status}});
}
function answer(h,id,text='I checked the process and compared the observations with the records.') {
  h.event({type:'input_audio_buffer.speech_started',item_id:id});
  h.event({type:'input_audio_buffer.speech_stopped',item_id:id});
  h.event({type:'conversation.item.created',item:{id,role:'user'}});
  h.event({type:'input_audio_buffer.committed',item_id:id});
  h.event({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});
}
function begin(h) {
  assistant(h,'greet','Hi. Before we begin, can you hear me clearly?');
  answer(h,'ack','Yes, I can.');
  assistant(h,'opening','Tell me about a process improvement you led.');
}
const requests = h => h.sends.filter(s=>s.type==='response.create');

test('budget requests at most two follow-ups, changes competency, and eventually closes',()=>{
  const p=createVoiceTurnPlan();
  const plans=Array.from({length:11},()=>p.next());
  assert.deepEqual(plans.slice(0,7).map(p=>[p.kind,p.topic]),[
    ['new_topic',0],['follow_up',0],['follow_up',0],['new_topic',1],['follow_up',1],['follow_up',1],['new_topic',2]
  ]);
  assert.match(plans[3].instruction,/collaboration|disagreement/);
  assert.match(plans[1].instruction,/do not presume a mismatch/);
  assert.equal(plans[9].kind,'final_invitation');
  assert.equal(plans[10].kind,'close');
});

test('no greeting or automatic reply before the effective turn configuration is acknowledged',async t=>{
  const h=await live(t,{autoTurnConfig:false});
  assert.equal(requests(h).length,0);
  h.event({type:'response.created',response:{id:'racing-auto'}});
  assert.ok(h.sends.some(s=>s.type==='response.cancel'));
  h.event(config);h.event(config);
  assert.equal(requests(h).length,1);
  h.event({type:'response.done',response:{id:'racing-auto',status:'cancelled'}});
  answer(h,'early-ack');
  assert.equal(requests(h).length,1,'cancelled pre-configuration response cannot release the greeting');
  assert.equal(requests(h)[0].response.metadata.jobhackai_purpose,'audio_check');
});

test('recorded seven-follow-up pattern gets new-topic requests after the second follow-up',async t=>{
  const h=await live(t);begin(h);
  for(let i=0;i<7;i++) {
    answer(h,'answer-'+i,i===2?'The records were consistent with what I observed.':undefined);
    // Even if the model tries to keep probing, the next request is selected
    // by app state, not by its assertion that it has followed the prompt.
    assistant(h,'follow-'+i,'What other detail did you investigate?');
  }
  assert.deepEqual(requests(h).slice(1).map(r=>r.response.metadata.jobhackai_purpose),
    ['new_topic','follow_up','follow_up','new_topic','follow_up','follow_up','new_topic','follow_up']);
  for(const item of h.sends.filter(s=>s.type==='conversation.item.create')) {
    h.event({type:'conversation.item.created',item:item.item});
  }
  await h.endInterview();
  assert.ok(!JSON.stringify(h.completeBodies()[0].transcript).includes('application turn instruction'));
});

test('duplicate commits and stale done events cannot create simultaneous replies',async t=>{
  const h=await live(t);begin(h);
  answer(h,'one');
  h.event({type:'response.created',response:{id:'reply-one'}});
  const n=requests(h).length;
  h.event({type:'input_audio_buffer.committed',item_id:'one'});
  answer(h,'two');
  h.event({type:'response.done',response:{id:'opening',status:'completed'}});
  assert.equal(requests(h).length,n);
  h.event({type:'response.done',response:{id:'reply-one',status:'cancelled'}});
  assert.equal(requests(h).length,n+1);
});

test('barge-in keeps the next request waiting until the candidate commits the continued answer',async t=>{
  const h=await live(t);begin(h);answer(h,'one');
  h.event({type:'response.created',response:{id:'reply'}});
  h.event({type:'output_audio_buffer.started',response_id:'reply'});
  h.event({type:'input_audio_buffer.speech_started',item_id:'continuation'});
  h.event({type:'output_audio_buffer.cleared',response_id:'reply'});
  h.event({type:'response.done',response:{id:'reply',status:'cancelled'}});
  const n=requests(h).length;
  h.event({type:'input_audio_buffer.speech_stopped',item_id:'continuation'});
  assert.equal(requests(h).length,n,'no fixed-delay or speech-stopped reply');
  answer(h,'continuation');
  assert.equal(requests(h).length,n+1);
});

test('a repeated audio check does not spend the interview follow-up budget',async t=>{
  const h=await live(t);
  assistant(h,'greet','Hi. Can you hear me clearly?');answer(h,'cannot','I cannot hear you.');
  assistant(h,'repeat','Can you hear me clearly now?');answer(h,'yes','Yes.');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'new_topic');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_topic,'0');
});

test('reconnect preserves the topic budget while configuring the new channel',async t=>{
  const h=await live(t);begin(h);
  answer(h,'one');assistant(h,'f1','What did you compare?');
  answer(h,'two');assistant(h,'f2','What was the result?');
  h.peerConnection().connectionState='disconnected'; h.peerConnection().onconnectionstatechange();
  await h.click('vi-reconnect-btn'); await h.openDataChannel();
  answer(h,'three');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'new_topic');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_topic,'1');
});

test('Finish discards a queued reply even when the preceding response completes late',async t=>{
  const h=await live(t);begin(h);answer(h,'one');
  h.event({type:'response.created',response:{id:'reply'}});answer(h,'two');
  const n=requests(h).length;
  await h.endInterview();
  h.event({type:'response.done',response:{id:'reply',status:'completed'}});
  assert.equal(requests(h).length,n);
  assert.equal(h.completeBodies().length,1);
});

test('missing turn module stops before microphone access or session consumption',async t=>{
  let micCalls=0;
  const h=createVoiceClientHarness({withoutModules:['createVoiceTurnPlan'],getUserMedia:async()=>{micCalls++;throw Error('unexpected');},routes:{'/api/plan/me':()=>PLAN_PAYLOAD}});
  t.after(()=>h.dispose());await h.ready();h.el('vi-role').value='Engineer';await h.click('vi-start-btn');
  assert.equal(micCalls,0);assert.ok(!h.requests.some(r=>r.method==='POST'));
  assert.ok(h.logs.some(r=>r[0]==='alert'&&/Refresh/.test(r[1])));
});

test('configuration rejection closes the attempt instead of leaving a silent paid call',async t=>{
  const h=await live(t,{autoTurnConfig:false});
  h.event({type:'error',error:{code:'invalid_value',message:'rejected configuration'}});
  await h.settle();
  assert.equal(requests(h).length,0);
  assert.equal(h.completeBodies()[0].reason,'connection_lost');
  assert.equal(h.peerConnection().connectionState,'closed');
});

test('an unrelated protocol error does not terminate the active answer, but a rejected turn request does',async t=>{
  const h=await live(t);begin(h);answer(h,'one');
  h.event({type:'error',error:{event_id:'old-cancel',message:'No response to cancel'}});
  await h.settle();
  assert.equal(h.completeBodies().length,0);
  h.event({type:'error',error:{event_id:requests(h).at(-1).event_id,message:'Rejected turn'}});
  await h.settle();
  assert.equal(h.completeBodies()[0].reason,'connection_lost');
});

test('a missing configuration acknowledgement cannot leave a paid attempt silently running',async t=>{
  const h=await live(t,{autoTurnConfig:false,timerDelay:ms=>ms===8000?1:ms});
  await new Promise(resolve=>setTimeout(resolve,20));await h.settle();
  assert.equal(requests(h).length,0);
  assert.equal(h.completeBodies()[0].reason,'connection_lost');
});

test('a request that never completes is saved and closed instead of leaving a silent interview',async t=>{
  const h=await live(t,{timerDelay:ms=>ms===45000?1:ms});
  await new Promise(resolve=>setTimeout(resolve,20));await h.settle();
  assert.equal(h.completeBodies()[0].reason,'connection_lost');
  assert.equal(h.peerConnection().connectionState,'closed');
});
