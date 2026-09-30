import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreVoiceTranscript, interviewEvidenceTranscript, groundedCompetencies } from '../voice-scorecard.js';
import { createVoiceClientHarness, PLAN_PAYLOAD } from './helpers/voice-client-harness.mjs';

function createHarness({report}) { return createVoiceClientHarness({search:'?session='+report.sessionId,routes:{'/api/plan/me':()=>PLAN_PAYLOAD,'/api/voice/sessions':()=>({sessions:[]}),'/api/voice/session/':()=>report}}); }

const answer = 'I compared customer interviews with support tickets and found that setup failures were preventing adoption. I prioritized an onboarding fix over a requested reporting feature, tested it with five customers, and measured whether they completed setup without support.';

test('long interviewer speech cannot cause a tiny candidate answer to receive a score', async () => {
  const result = await scoreVoiceTranscript({role:'Product Manager',transcript:[
    {speaker:'assistant',text:'Explain a project. '.repeat(100)},
    {speaker:'user',text:'Yes, thank you.'}
  ]}, {});
  assert.equal(result.scorecard.tooShort,true);
  assert.equal(result.scorecard.overall,null);
  assert.equal(result.usage,null);
});

test('session controls cannot manufacture enough evidence for a score', async () => {
  const result = await scoreVoiceTranscript({role:'Scrum Master', transcript:[
    {speaker:'assistant',text:'Describe a conflict.'},
    ...Array.from({length:8},()=>({speaker:'user',text:"I'd like to end this now."})),
    {speaker:'user',text:'Can you hear me?'},
    {speaker:'user',text:'I would like to end this now.'}
  ]}, {});
  assert.equal(result.scorecard.tooShort, true);
  assert.equal(result.model, null);
});

test('technical and stop requests are excluded without removing workplace stories', () => {
  const answers = [
    'I would like to leave.',
    'I would like to leave my current job for more responsibility.',
    'The customer asked, can you hear me? I reconnected the audio and verified it.',
    'I stopped, I looked, and I listened.'
  ];
  const input = [...answers, 'Can you hear me?', "I'd like to end this now.", 'I would like to end this now.']
    .map(text=>({speaker:'user',text}));
  assert.deepEqual(interviewEvidenceTranscript(input).map(turn=>turn.text), answers);
  assert.equal(input.length, 7, 'filtering must not rewrite the saved transcript');
});

test('existing report competency quotes cannot use session controls as evidence', () => {
  const old = [{name:'Outcomes',status:'needs_practice',quote:"I'd like to end this now.",feedback:'You gave no outcome.'}];
  const cleaned = groundedCompetencies(old, [{speaker:'user',text:"I'd like to end this now."}]);
  assert.equal(cleaned[0].status, 'not_assessed');
  assert.equal(cleaned[0].quote, '');
  assert.doesNotMatch(cleaned[0].feedback, /gave no outcome/);
  assert.equal(old[0].status, 'needs_practice', 'the stored report is not rewritten');
});

test('scoring prompt and grounded quotes exclude controls even for an old client', async t => {
  const original=globalThis.fetch; t.after(()=>globalThis.fetch=original);
  let prompt='';
  globalThis.fetch=async (_url, options)=> {
    prompt=JSON.parse(options.body).messages.map(message=>message.content).join('\n');
    return Response.json({choices:[{message:{content:JSON.stringify({
      overall:70,
      moments:[{quote:"I'd like to end this now.",comment:'Missing outcome.'},{quote:'Can you hear me?',comment:'Unclear communication.'}],
      competencies:[{name:'Outcomes',status:'needs_practice',quote:"I'd like to end this now.",feedback:'No outcome.'}]
    })},finish_reason:'stop'}],usage:{}});
  };
  const {scorecard}=await scoreVoiceTranscript({role:'Product Manager',transcript:[
    {speaker:'assistant',text:'Explain a project.'},
    {speaker:'user',text:answer},
    {speaker:'user',text:'Can you hear me?'},
    {speaker:'user',text:"I'd like to end this now."}
  ]},{OPENAI_API_KEY:'test-fixture'});
  assert.doesNotMatch(prompt,/CANDIDATE: (?:Can you hear me|I'd like to end this now)/);
  assert.ok(prompt.includes(answer));
  assert.deepEqual(scorecard.moments,[]);
  assert.equal(scorecard.competencies[0].status,'not_assessed');
  assert.equal(scorecard.competencies[0].quote,'');
});

test('real scoring path removes unsupported competency evidence and retains grounded evidence', async t => {
  const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
  globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({
    overall:70,moments:[],competencies:[
      {name:'Prioritization',status:'demonstrated',quote:'I prioritized an onboarding fix over a requested reporting feature',feedback:'Explain the tradeoff evidence.'},
      {name:'Leadership',status:'demonstrated',quote:'I led fifty employees.',feedback:'Excellent leadership.'},
      {name:'Budgeting',status:'not_assessed',quote:'Explain a project.',feedback:'You lack budgeting skills.'}
    ]})},finish_reason:'stop'}],usage:{}});
  const {scorecard}=await scoreVoiceTranscript({role:'Product Manager',transcript:[{speaker:'assistant',text:'Explain a project.'},{speaker:'user',text:answer}]},{OPENAI_API_KEY:'test-fixture'});
  assert.equal(scorecard.methodologyVersion,2);
  assert.equal(scorecard.competencies[0].status,'demonstrated');
  for(const c of scorecard.competencies.slice(1)) {
    assert.equal(c.status,'not_assessed');assert.equal(c.quote,'');
    assert.doesNotMatch(c.feedback,/excellent|lack budgeting/i);
  }
});

test('full report renders scoped competency feedback safely without a ratio target',async()=>{
  const h=createHarness({report:{sessionId:'v2',fullAccess:true,status:'completed',scorecardReady:true,scorecard:{
    methodologyVersion:2,overall:72,assessmentScope:'Senior PM practice sample; stakeholder leadership was not explored.',
    dimensions:{communication:70,structure:80,contentDepth:65,roleFit:75},saoBalance:{situation:20,action:60,outcome:20},
    topStrength:'Clear decision.',topImprovement:'Explain the evidence.',competencies:[{name:'<script>bad</script>',status:'not_assessed',quote:'',feedback:'Not explored.'}]
  }}});
  await h.ready();
  const html=h.el('vi-scorecard').innerHTML;
  assert.match(html,/Practice sample/);assert.match(html,/Not assessed/);assert.match(html,/stakeholder leadership/);
  assert.doesNotMatch(html,/goal ≈|85%|<script>/);
  assert.match(html,/&lt;script&gt;/);h.dispose();
});

test('too-short report has no numeric grade or dimensions',async()=>{
  const h=createHarness({report:{sessionId:'short',fullAccess:true,status:'completed',scorecardReady:true,scorecard:{methodologyVersion:2,tooShort:true,overall:null,topStrength:'Too short.',topImprovement:'Try a complete answer.'}}});
  await h.ready();
  const html=h.el('vi-scorecard').innerHTML;
  assert.match(html,/Not enough candidate speech/);assert.doesNotMatch(html,/vi-sc-score|vi-sc-dims/);h.dispose();
});
