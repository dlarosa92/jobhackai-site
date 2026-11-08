import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceTurnPlan, classifyVoiceTurnControl } from '../../../../js/voice-turn-plan.js';
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

test('repeat and rephrase controls do not spend interview questions or force a close',async t=>{
  const h=await live(t);begin(h);
  for (const [i,text] of [
    'Could you repeat that, please?', 'Next question, please.',
    'Could you reframe that more simply, please?', 'Next question, please.',
    'Could we use a different example?', 'Can you hear me?',
    "I'm sorry, could you rephrase that?", "No, no, I'm sorry, I'm sorry, could you rephrase that?",
    'Could you repeat the question please?', 'Could you rephrase that more simply?'
  ].entries()) {
    answer(h,'control-'+i,text);
    assert.ok(!['final_invitation','close'].includes(requests(h).at(-1).response.metadata.jobhackai_purpose),text);
    assistant(h,'control-reply-'+i,'Tell me about a process improvement you led.');
  }
  answer(h,'actual-answer','I compared the intake records and reduced the turnaround by two days.');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'follow_up');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_topic,'0');
  const context=h.sends.filter(x=>x.type==='conversation.item.create'&&x.item.role==='system').at(-1);
  assert.match(context.item.content[0].text,/follow-up opportunity 1 of 2/);
  assert.equal(h.completeBodies().length,0);
});

test('a candidate asking to start an example at the final invitation gets to speak',()=>{
  const p=createVoiceTurnPlan();
  for(let i=0;i<10;i++)p.next();
  const next=p.next({candidateText:'So I want to give example of something.'});
  assert.equal(next.kind,'continue_answer');
  assert.doesNotMatch(next.instruction,/Close now/);
  assert.equal(p.next({candidateText:'I compared the records, fixed intake and cut the delay by two days.'}).kind,'close');
});

test('the recorded compound clarification preserves the current question at a topic boundary',async t=>{
  const h=await live(t);begin(h);
  for(let i=0;i<5;i++) {
    answer(h,'answer-'+i,'I compared the records, discussed the evidence with the team and agreed on a pilot.');
    assistant(h,'question-'+i,i===4
      ? 'How did you ensure that the trust you built translated into improved collaboration on the project?'
      : 'What happened next?');
  }
  const clarification='What do you mean exactly? Could you elaborate on the question?';
  answer(h,'clarification',clarification);
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'rephrase');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_topic,'1');
  const context=h.sends.filter(x=>x.type==='conversation.item.create'&&x.item.role==='system').at(-1).item.content[0].text;
  assert.match(context,/trust you built translated into improved collaboration/);
  assert.match(context,/Do not add a new question or change the topic/);
  assistant(h,'clarified','How did that trust help you work together on the project?');
  answer(h,'real-answer','We reviewed the handoff failures together and agreed on the next change.');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'new_topic');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_topic,'2');
  await h.endInterview();
  assert.ok(h.completeBodies()[0].transcript.some(x=>x.text===clarification),'retain the actual conversation');
});

for (const [text,kind] of [
  ['Could you repeat that, please?','repeat'], ['Say that again.','repeat'],
  ['Could you please repeat that question?','repeat'],
  ['Could you repeat or rephrase that question?','rephrase'],
  ['Could you put that another way?','rephrase'], ["I don't understand the question.",'rephrase'],
  ['What do you mean by that?','rephrase'], ["Let's move on.",'change_question'],
  ['What do you mean exactly? Could you elaborate on the question?','rephrase'],
  ['What do you mean exactly could you elaborate on the question','rephrase'],
  ['What exactly do you mean?','rephrase'],
  ['Could you elaborate on that?','rephrase'],
  ['Could you explain what you mean by that?','rephrase'],
  ["I don't understand the question. Could you repeat it?",'rephrase'],
  ['Could you repeat that? Could you rephrase it more simply?','rephrase'],
  ['What do you mean exactly? I compared our records and reduced the delay.',null],
  ['Could you elaborate on the question? I chose the project with the largest return.',null],
  ['During training, I asked, "What do you mean exactly? Could you elaborate on the question?"',null],
  ['Could you elaborate on the question of how I measured savings?',null],
  ['Could you repeat that? Next question, please.',null],
  ['Could you reframe that more simply, please?','rephrase'],
  ["No, no, I'm sorry, I'm sorry, could you rephrase that?",'rephrase'],
  ['Can you hear me?','hearing_check'], ["I couldn't hear the question.",'hearing_check'],
  ['Hello, can you hear me okay?','hearing_check'], ['Hey, could you hear me ok?','hearing_check'],
  ["Hi, I can't hear you now.",'hearing_check'], ["Sorry, I cannot hear you clearly.",'hearing_check'],
  ['Next question, please.','change_question'], ['Could we use a different example?','change_question'],
  ['Can I skip this question?','change_question'], ['Let me finish my answer.','continue_answer'],
  ["Yes, I'd like to add something.",'continue_answer'],
  ['I have something to add.','continue_answer'], ['Can I give an example?','continue_answer'],
  ['I asked the customer to repeat the question.',null],
  ['During training, I said "could you repeat that?" to demonstrate the process.',null],
  ['Could you rephrase that? I compared our records and reduced the delay by two days.',null],
  ['I want to give an example of how I reduced the delay.',null],
  ['Yes.',null], ['No.',null], ['I skipped the test because our manager approved the change.',null],
  ["During a past training session I said let's end the interview here as part of a role-play.",null]
]) test('standalone control classification: '+text,()=>assert.equal(classifyVoiceTurnControl(text),kind));

test('yes to the final invitation invites the answer, while an ordinary yes still advances',()=>{
  const p=createVoiceTurnPlan();p.next();
  assert.equal(p.next({candidateText:'Yes.'}).kind,'follow_up');
  for(let i=0;i<8;i++)p.next();
  assert.equal(p.next({candidateText:'Yes, please.'}).kind,'continue_answer');
  assert.equal(p.next({candidateText:'No.'}).kind,'close');
});

test('final-invitation rephrasing and continuation preserve the final answer opportunity',async t=>{
  const h=await live(t);begin(h);
  for(let i=0;i<9;i++) { answer(h,'normal-'+i);assistant(h,'normal-reply-'+i,'What else would you like to add?'); }
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'final_invitation');
  const invitation=h.sends.filter(x=>x.type==='conversation.item.create'&&x.item.role==='system').at(-1);
  assert.match(invitation.item.content[0].text,/before we finish.*Then wait for their answer/);
  assert.equal(h.completeBodies().length,0,'the final invitation does not end the interview');
  assert.ok(h.peerConnection().tracks.every(track=>track.enabled===true),'the final answer opportunity keeps the microphone on');
  answer(h,'repeat-final','Could you repeat that please?');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'repeat');
  assistant(h,'repeat-final-reply','What else would you like to add?');
  answer(h,'preface','So I want to give example of something.');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'continue_answer');
  assistant(h,'go-ahead','Go ahead.');
  answer(h,'last-example','I compared the records and reduced the delay by two days.');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'close');
});

test('mixed answer fragments cannot be discarded as a standalone conversation control',async t=>{
  const h=await live(t);begin(h);
  commit(h,'first');commit(h,'second');
  transcribe(h,'first','Could you repeat that?');
  transcribe(h,'second','Actually I compared the records and reduced the delay.');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'follow_up');
});

const RECORDED_CLOSING = "Thank you for sharing that detail. I'll note that, and your feedback report is being prepared and will appear on this page.";
async function plannedClosing(t, options = {}) {
  const h=await live(t, options);begin(h);
  for(let i=0;i<9;i++) { answer(h,'planned-answer-'+i);assistant(h,'planned-question-'+i,'What else would you like to add?'); }
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'final_invitation');
  answer(h,'final-example','I documented the handoff and checked the result with the team.');
  const response={id:'planned-closing',status:'completed',metadata:requests(h).at(-1).response.metadata};
  assert.equal(response.metadata.jobhackai_purpose,'close');
  return {h,response};
}

test('the terminal closing cannot reuse the previous invitation or answer as response context',async t=>{
  const {h}=await plannedClosing(t);
  const closing=requests(h).at(-1).response;
  assert.deepEqual(closing.input,[],'the final closing has no conversational input to continue');
  assert.match(closing.instructions,/Say only these exact words/);
  assert.match(closing.instructions,/This interview is now complete/);
  assert.match(closing.instructions,/Do not ask a question or invite another answer/);
  assert.doesNotMatch(closing.instructions,/normal brief closing statement|Keep the interview, conduct, safety and closing rules/);
  assert.equal(h.completeBodies().length,0,'the fixed closing still waits for playback');
});

test('the planned closing visibly explains that candidate capture has ended',async t=>{
  const {h}=await plannedClosing(t);
  assert.match(h.el('vi-input-status').textContent,/Interview complete\. Microphone off\./);
  assert.ok(h.peerConnection().tracks.every(track=>track.enabled===false));
});

test('the planned closing ends on playback completion without recognizing its wording',async t=>{
  const {h,response}=await plannedClosing(t);
  assert.ok(h.peerConnection().tracks.every(track=>track.enabled===false),'stop candidate capture when the app requests its final closing');
  h.event({type:'response.created',response});
  assert.ok(!h.sends.some(x=>x.type==='response.cancel'),'allow the planned closing to play');
  h.event({type:'output_audio_buffer.started',response_id:response.id});
  h.event({type:'conversation.item.created',item:{id:'planned-closing-item',role:'assistant'}});
  h.event({type:'response.output_audio_transcript.done',response_id:response.id,item_id:'planned-closing-item',transcript:RECORDED_CLOSING});
  h.event({type:'response.done',response});
  await h.settle();
  assert.equal(h.completeBodies().length,0,'generation is not playback completion');
  const n=requests(h).length;
  answer(h,'late-chatter','I would like to add a different example.');
  assert.equal(requests(h).length,n,'closing cannot start another interview question');
  h.event({type:'output_audio_buffer.stopped',response_id:response.id});
  await h.settle();
  assert.equal(h.completeBodies().length,1);
  assert.equal(h.completeBodies()[0].reason,'completed');
  assert.ok(h.completeBodies()[0].transcript.some(x=>x.text===RECORDED_CLOSING));
  assert.ok(!h.completeBodies()[0].transcript.some(x=>x.text.includes('different example')));
  h.event({type:'output_audio_buffer.stopped',response_id:response.id});
  h.event({type:'response.done',response});
  await h.settle();
  assert.equal(h.completeBodies().length,1,'duplicate receipts never save twice');
});

test('previous and duplicate responses cannot cut off a planned closing',async t=>{
  const {h,response}=await plannedClosing(t);
  h.event({type:'response.created',response:{id:'late-previous'}});
  h.event({type:'response.done',response:{id:'late-previous',status:'completed'}});
  h.event({type:'output_audio_buffer.stopped',response_id:'late-previous'});
  assert.ok(h.sends.some(x=>x.type==='response.cancel'&&x.response_id==='late-previous'));
  h.event({type:'response.created',response});
  h.event({type:'output_audio_buffer.started',response_id:response.id});
  h.event({type:'response.done',response:{id:'planned-question-8',status:'completed'}});
  h.event({type:'output_audio_buffer.stopped',response_id:'planned-question-8'});
  h.event({type:'response.created',response:{...response,id:'unexpected-copy'}});
  h.event({type:'response.done',response:{...response,id:'unexpected-copy'}});
  h.event({type:'output_audio_buffer.stopped',response_id:'unexpected-copy'});
  await h.settle();
  assert.equal(h.completeBodies().length,0);
  assert.ok(h.sends.some(x=>x.type==='response.cancel'&&x.response_id==='unexpected-copy'));
  h.event({type:'response.done',response});
  h.event({type:'output_audio_buffer.stopped',response_id:response.id});
  await h.settle();
  assert.equal(h.completeBodies().length,1);
  assert.equal(h.completeBodies()[0].reason,'completed');
});

for(const withoutModules of [[],['createClosingTurnGate']]) {
  test('an absent planned closing response is bounded: '+JSON.stringify(withoutModules),async t=>{
    const {h}=await plannedClosing(t,{withoutModules,timerDelay:ms=>ms===30000?5:ms});
    await new Promise(resolve=>setTimeout(resolve,20));await h.settle();
    assert.equal(h.completeBodies().length,1);
    assert.equal(h.completeBodies()[0].reason,'completed');
  });
}

test('a planned closing without buffer events uses its own response completion',async t=>{
  const {h,response}=await plannedClosing(t,{timerDelay:ms=>ms===750?5:ms});
  h.event({type:'response.created',response});
  h.event({type:'response.done',response});
  await new Promise(resolve=>setTimeout(resolve,20));await h.settle();
  assert.equal(h.completeBodies().length,1);
  assert.equal(h.completeBodies()[0].reason,'completed');
});

test('control recovery stays on its topic after reconnect and duplicates do not spend a turn',async t=>{
  const h=await live(t);begin(h);
  answer(h,'repeat','Could you repeat that please?');
  assistant(h,'repeated','Tell me about a process improvement you led.');
  h.peerConnection().connectionState='disconnected';h.peerConnection().onconnectionstatechange();
  await h.click('vi-reconnect-btn');await h.openDataChannel();
  assistant(h,'reconnected','Tell me about a process improvement you led.');
  const n=requests(h).length;
  answer(h,'rephrase','Could you rephrase that?');
  transcribe(h,'rephrase','Could you rephrase that?');
  assert.equal(requests(h).length,n+1);
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'rephrase');
  assistant(h,'simpler','What process did you improve?');answer(h,'real');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_topic,'0');
  const context=h.sends.filter(x=>x.type==='conversation.item.create'&&x.item.role==='system').at(-1);
  assert.match(context.item.content[0].text,/follow-up opportunity 1 of 2/);
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

test('a terminal empty output item releases an interrupted caption without a separate transcript event',async t=>{
  const h=await live(t);begin(h);answer(h,'first','Yes.');
  h.event({type:'response.created',response:{id:'interrupted'}});
  h.event({type:'conversation.item.created',item:{id:'interrupted-item',role:'assistant'}});
  h.event({type:'response.done',response:{id:'interrupted',status:'cancelled'}});
  const n=requests(h).length;
  answer(h,'continued','I also checked the outcome with the team.');
  assert.equal(requests(h).length,n);
  h.event({type:'response.output_item.done',response_id:'interrupted',item:{id:'interrupted-item',type:'message',role:'assistant',content:[]}});
  assert.equal(requests(h).length,n+1);
});

for (const echo of [true,false]) test('final response output settles missing caption while retaining echo filtering: '+echo,async t=>{
  const h=await live(t);begin(h);answer(h,'first','Yes.');
  const question='Tell me about a time when you influenced a stakeholder who disagreed.';
  h.event({type:'response.created',response:{id:'next'}});
  h.event({type:'conversation.item.created',item:{id:'next-item',role:'assistant'}});
  const n=requests(h).length;
  answer(h,'candidate',echo?question:'I compared customer research with our baseline and agreed on a pilot.');
  h.event({type:'response.done',response:{id:'next',status:'completed',output:[{id:'next-item',type:'message',role:'assistant',content:[{type:'audio',transcript:question}]}]}});
  assert.equal(requests(h).length,n+(echo?0:1));
  assert.equal(h.sends.some(x=>x.type==='conversation.item.delete'&&x.item_id==='candidate'),echo);
});

test('missing input transcription offers recovery without ending or spending another interview',async t=>{
  const h=await live(t,{timerDelay:ms=>ms===15000?1:ms});begin(h);
  commit(h,'missing');answer(h,'later','I verified the result against our baseline.');
  const n=requests(h).length;
  await new Promise(r=>setTimeout(r,20));await h.settle();
  assert.match(h.el('vi-status').textContent,/not responding/i);
  assert.equal(h.el('vi-reconnect-btn').style.display,'');
  assert.equal(h.completeBodies().length,0);
  assert.equal(requests(h).length,n,'no forced response over unresolved input');
  assert.equal(h.requests.filter(r=>r.url==='/api/voice/session'&&r.method==='POST').length,1);
});

test('a stalled connected call can reconnect, replay the question, and retain captured answers',async t=>{
  const h=await live(t,{timerDelay:ms=>ms===15000?1:ms});begin(h);
  h.peerConnection().connectionState='connected';
  commit(h,'missing');answer(h,'kept','I verified the result against our baseline.');
  await new Promise(r=>setTimeout(r,20));await h.settle();
  const old=h.peerConnection();old.onconnectionstatechange();
  assert.equal(h.el('vi-reconnect-btn').style.display,'','a transport-connected event cannot hide reply recovery');
  assert.match(h.el('vi-status').textContent,/not responding/i);
  await h.click('vi-reconnect-btn');
  assert.notEqual(h.peerConnection(),old,'healthy transport does not hide a stalled reply');
  await h.openDataChannel();
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'audio_recovery');
  const resume=h.requests.filter(r=>r.url==='/api/voice/session').at(-1).body;
  assert.equal(resume.resumeSessionId,'budget-test');
  assert.ok(resume.transcript.some(x=>x.text==='I verified the result against our baseline.'));
  assistant(h,'replay','Tell me about a process improvement you led.');
  answer(h,'recovered','The rollout reduced turnaround by two days.');
  assert.equal(requests(h).at(-1).response.metadata.jobhackai_purpose,'follow_up');
  assert.equal(h.completeBodies().length,0);
});

test('a missing assistant caption cannot silently block replies until the session deadline',async t=>{
  const h=await live(t,{timerDelay:ms=>ms===15000?1:ms});begin(h);answer(h,'first','Yes.');
  h.event({type:'response.created',response:{id:'lost-caption'}});
  h.event({type:'conversation.item.created',item:{id:'lost-caption-item',role:'assistant'}});
  h.event({type:'response.done',response:{id:'lost-caption',status:'cancelled'}});
  answer(h,'continued','I also checked the outcome with the team.');
  await new Promise(r=>setTimeout(r,20));await h.settle();
  assert.match(h.el('vi-status').textContent,/not responding/i);
  assert.equal(h.completeBodies().length,0);
});

test('continued speech cancels the recovery timer instead of interrupting an answer',async t=>{
  const h=await live(t,{timerDelay:ms=>ms===15000?1:ms});begin(h);
  commit(h,'fragment');h.event({type:'input_audio_buffer.speech_started',item_id:'continued'});
  await new Promise(r=>setTimeout(r,20));await h.settle();
  assert.doesNotMatch(h.el('vi-status').textContent,/not responding/i);
  assert.equal(h.completeBodies().length,0);
});

test('normal legacy playback completion does not offer a false reply recovery',async t=>{
  const h=await live(t,{timerDelay:ms=>ms===15000?1:ms});begin(h);
  answer(h,'answer','I checked the outcome with the business owner.');
  assistant(h,'reply','How did you verify the change?');
  await new Promise(r=>setTimeout(r,20));await h.settle();
  assert.doesNotMatch(h.el('vi-status').textContent,/not responding/i);
});

test('a delayed audible reply clears recovery and permits the following answer',async t=>{
  const h=await live(t,{timerDelay:ms=>ms===15000?1:ms});begin(h);
  answer(h,'answer','I verified the result against our baseline.');
  await new Promise(r=>setTimeout(r,20));await h.settle();
  assert.match(h.el('vi-status').textContent,/not responding/i);
  h.event({type:'response.created',response:{id:'late-reply'}});
  h.event({type:'output_audio_buffer.started',response_id:'late-reply'});
  assert.doesNotMatch(h.el('vi-status').textContent,/not responding/i);
  assert.equal(h.el('vi-reconnect-btn').style.display,'none');
  h.event({type:'response.output_audio_transcript.done',item_id:'late-reply-item',response_id:'late-reply',transcript:'How did you verify that result?'});
  h.event({type:'response.done',response:{id:'late-reply',status:'completed'}});
  h.event({type:'output_audio_buffer.stopped',response_id:'late-reply'});
  const n=requests(h).length;
  answer(h,'next','I checked the following week with the team.');
  assert.equal(requests(h).length,n+1);
});

test('an active response timeout offers recovery without closing the interview',async t=>{
  // Compress only the response under test. Compressing the setup greeting as
  // well can close the attempt before begin() on a loaded CI runner.
  let expireActiveResponse=false;
  const h=await live(t,{timerDelay:ms=>expireActiveResponse&&ms===45000?1:ms});
  await new Promise(r=>setTimeout(r,10));begin(h);
  expireActiveResponse=true;
  answer(h,'answer','I verified the result against our baseline.');
  await new Promise(r=>setTimeout(r,20));await h.settle();
  assert.match(h.el('vi-status').textContent,/not responding/i);
  assert.equal(h.completeBodies().length,0);
});

test('a completed delayed legacy reply clears recovery and permits the following answer',async t=>{
  const h=await live(t,{timerDelay:ms=>ms===15000?1:ms});begin(h);
  answer(h,'answer','I verified the result against our baseline.');
  await new Promise(r=>setTimeout(r,20));await h.settle();
  assert.match(h.el('vi-status').textContent,/not responding/i);
  assistant(h,'late-legacy','How did you verify that result?');
  assert.doesNotMatch(h.el('vi-status').textContent,/not responding/i);
  assert.equal(h.el('vi-reconnect-btn').style.display,'none');
  const n=requests(h).length;
  answer(h,'next','I checked the following week with the team.');
  assert.equal(requests(h).length,n+1);
});

test('Finish cancels a pending reply recovery and late snapshots cannot reopen the interview',async t=>{
  const h=await live(t,{timerDelay:ms=>ms===15000?10:ms});begin(h);
  commit(h,'missing');await h.endInterview();
  h.event({type:'response.output_item.done',response_id:'late',item:{id:'late-item',type:'message',role:'assistant',content:[]}});
  await new Promise(r=>setTimeout(r,20));await h.settle();
  assert.equal(h.completeBodies().length,1);
  assert.doesNotMatch(h.el('vi-status').textContent,/not responding/i);
  assert.equal(h.peerConnection().connectionState,'closed');
});
