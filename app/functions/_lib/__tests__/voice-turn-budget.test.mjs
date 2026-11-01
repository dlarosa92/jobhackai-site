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

function commit(h,id) {
  h.event({type:'input_audio_buffer.speech_started',item_id:id});
  h.event({type:'input_audio_buffer.speech_stopped',item_id:id});
  h.event({type:'conversation.item.created',item:{id,role:'user'}});
  h.event({type:'input_audio_buffer.committed',item_id:id});
}
function transcribe(h,id,text) {
  h.event({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});
}

for(const text of ['', '   ', 'You.', 'Um.', 'Tell me about a process improvement you led.', null]) {
  test('unusable audio cannot request or spend a follow-up: '+JSON.stringify(text),async t=>{
    const h=await live(t);begin(h);const n=requests(h).length;
    commit(h,'noise');assert.equal(requests(h).length,n,'an audio commit is not an answer');
    if(text===null)h.event({type:'conversation.item.input_audio_transcription.failed',item_id:'noise'});
    else transcribe(h,'noise',text);
    assert.equal(requests(h).length,n,'silence, noise, echo and failed ASR are not answers');
    assert.ok(h.sends.some(x=>x.type==='conversation.item.delete'&&x.item_id==='noise'),'discarded audio cannot steer a later reply');
    answer(h,'real','Yes.');
    assert.equal(requests(h).length,n+1,'a short real answer still works');
    const context=h.sends.filter(x=>x.type==='conversation.item.create'&&x.item.role==='system').at(-1);
    assert.match(context.item.content[0].text,/follow-up opportunity 1 of 2/);
  });
}

test('transcription before commit waits for the matching commit and duplicate events request only one reply',async t=>{
  const h=await live(t);begin(h);const n=requests(h).length;
  h.event({type:'conversation.item.created',item:{id:'answer',role:'user'}});
  transcribe(h,'answer','I reduced the turnaround by two days.');
  assert.equal(requests(h).length,n);
  h.event({type:'input_audio_buffer.committed',item_id:'answer'});
  assert.equal(requests(h).length,n+1);
  h.event({type:'input_audio_buffer.committed',item_id:'answer'});
  transcribe(h,'answer','I reduced the turnaround by two days.');
  assistant(h,'reply','How did you measure it?');
  assert.equal(requests(h).length,n+1);
});

test('the same short answer to a later question survives a delayed interviewer caption',async t=>{
  const h=await live(t);begin(h);answer(h,'first-yes','Yes.');
  h.event({type:'response.created',response:{id:'next-question'}});
  h.event({type:'conversation.item.created',item:{id:'next-question-item',role:'assistant'}});
  h.event({type:'response.done',response:{id:'next-question',status:'completed'}});
  const n=requests(h).length;
  answer(h,'second-yes','Yes.');
  assert.equal(requests(h).length,n+1,'a distinct answer is not a replay of the first Yes');
  assert.ok(!h.sends.some(x=>x.type==='conversation.item.delete'&&x.item_id==='second-yes'));
  h.event({type:'response.output_audio_transcript.done',response_id:'next-question',item_id:'next-question-item',transcript:'Did you check the following week as well?'});
  await h.endInterview();
  assert.equal(h.completeBodies()[0].transcript.filter(x=>x.speaker==='user'&&x.text==='Yes.').length,2);
});

for (const echo of [true,false]) {
  test('delayed interviewer caption settles before accepting a long '+(echo?'echo':'real answer'),async t=>{
    const h=await live(t);begin(h);answer(h,'first','Yes.');
    const question='Tell me about a time when you had to influence a stakeholder who disagreed with your approach.';
    h.event({type:'response.created',response:{id:'next-question'}});
    h.event({type:'conversation.item.created',item:{id:'next-question-item',role:'assistant'}});
    h.event({type:'response.done',response:{id:'next-question',status:'completed'}});
    const n=requests(h).length;
    answer(h,'candidate',echo?question:'I showed our customer research and agreed on a smaller pilot.');
    assert.equal(requests(h).length,n,'an unfinished neighboring caption cannot establish absence of echo');
    h.event({type:'response.output_audio_transcript.done',response_id:'next-question',item_id:'next-question-item',transcript:question});
    assert.equal(requests(h).length,n+(echo?0:1));
    assert.equal(h.sends.some(x=>x.type==='conversation.item.delete'&&x.item_id==='candidate'),echo);
  });
}

test('an interrupted empty interviewer caption releases a waiting real answer',async t=>{
  const h=await live(t);begin(h);answer(h,'first','Yes.');
  h.event({type:'response.created',response:{id:'interrupted'}});
  h.event({type:'conversation.item.created',item:{id:'interrupted-item',role:'assistant'}});
  h.event({type:'response.done',response:{id:'interrupted',status:'cancelled'}});
  const n=requests(h).length;
  answer(h,'continued','I also checked the outcome with the team.');
  assert.equal(requests(h).length,n);
  h.event({type:'response.output_audio_transcript.done',response_id:'interrupted',item_id:'interrupted-item',transcript:''});
  assert.equal(requests(h).length,n+1,'a final empty caption is settled, not missing');
});

for (const type of ['conversation.item.created','conversation.item.added']) {
  test('conduct tool output cannot stall the next answer: '+type,async t=>{
    const h=await live(t);begin(h);answer(h,'first','Yes.');
    h.event({type:'response.created',response:{id:'warning'}});
    h.event({type,item:{id:'warning-call',type:'function_call',name:'conduct_action',call_id:'call-warning'}});
    h.event({type:'response.function_call_arguments.done',response_id:'warning',item_id:'warning-call',
      name:'conduct_action',call_id:'call-warning',arguments:JSON.stringify({stage:'warning'})});
    const result=h.sends.find(x=>x.item?.type==='function_call_output'&&x.item.call_id==='call-warning');
    assert.equal(JSON.parse(result.item.output).interview_continues,true);
    h.event({type,item:{id:'warning-output',...result.item}});
    assistant(h,'warning','Let us return to your example. What happened next?');
    const n=requests(h).length;
    answer(h,'continued','I showed the team our observations and we agreed on a pilot.');
    assert.equal(requests(h).length,n+1,'tool output has no caption to wait for');
  });
}

test('late transcription cannot interrupt continued speech or turn two answer fragments into two questions',async t=>{
  const h=await live(t);begin(h);const n=requests(h).length;
  commit(h,'first');
  h.event({type:'input_audio_buffer.speech_started',item_id:'continued'});
  transcribe(h,'first','I changed the process.');
  assert.equal(requests(h).length,n,'the candidate is still speaking');
  h.event({type:'input_audio_buffer.speech_stopped',item_id:'continued'});
  h.event({type:'conversation.item.created',item:{id:'continued',role:'user'}});
  h.event({type:'input_audio_buffer.committed',item_id:'continued'});
  assert.equal(requests(h).length,n,'wait for all committed fragments');
  transcribe(h,'continued','The change cut the delay by two days.');
  assert.equal(requests(h).length,n+1);
  assistant(h,'reply','How did you validate the result?');
  assert.equal(requests(h).length,n+1);
  await h.endInterview();
  assert.ok(h.completeBodies()[0].transcript.some(x=>x.text.includes('changed the process')));
  assert.ok(h.completeBodies()[0].transcript.some(x=>x.text.includes('cut the delay')));
});

test('out-of-order transcripts for already committed fragments generate one reply after both settle',async t=>{
  const h=await live(t);begin(h);const n=requests(h).length;
  commit(h,'first');commit(h,'second');
  transcribe(h,'second','The result was two days faster.');
  assert.equal(requests(h).length,n);
  transcribe(h,'first','I changed the intake process.');
  assert.equal(requests(h).length,n+1);
  assistant(h,'reply','What did you compare?');
  assert.equal(requests(h).length,n+1);
});

test('spoken Finish is resolved before any reply or turn-budget request',async t=>{
  const h=await live(t);begin(h);const n=requests(h).length;
  commit(h,'finish');assert.equal(requests(h).length,n);
  transcribe(h,'finish',"I'd like to finish this, please.");await h.settle();
  assert.equal(requests(h).length,n);
  assert.equal(h.completeBodies().length,1);
  assert.ok(!JSON.stringify(h.completeBodies()[0].transcript).includes('finish this'));
});

test('reconnect discards unsettled reply work while preserving captured answers',async t=>{
  const h=await live(t);begin(h);commit(h,'old');
  h.peerConnection().connectionState='disconnected';h.peerConnection().onconnectionstatechange();
  await h.click('vi-reconnect-btn');await h.openDataChannel();const n=requests(h).length;
  transcribe(h,'old','Late previous-connection words.');
  h.event({type:'input_audio_buffer.committed',item_id:'old'});
  assert.equal(requests(h).length,n);
  answer(h,'current','I completed the rollout.');assert.equal(requests(h).length,n+1);
});

test('missing transcript validation stops before microphone access or session consumption',async t=>{
  let micCalls=0;
  const h=createVoiceClientHarness({withoutModules:['createTranscriptOrder'],getUserMedia:async()=>{micCalls++;throw Error('unexpected');},routes:{'/api/plan/me':()=>PLAN_PAYLOAD}});
  t.after(()=>h.dispose());await h.ready();h.el('vi-role').value='Engineer';await h.click('vi-start-btn');
  assert.equal(micCalls,0);assert.ok(!h.requests.some(r=>r.method==='POST'));
  assert.ok(h.logs.some(r=>r[0]==='alert'&&/Refresh/.test(r[1])));
});

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
  answer(h,'two','I also compared the next week of measurements.');
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
  answer(h,'continuation','Let me clarify the comparison with our baseline.');
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
