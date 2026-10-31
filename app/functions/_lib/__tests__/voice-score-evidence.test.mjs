import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreEvidence, scoreVoiceTranscript, partialScorecard } from '../voice-scorecard.js';
import { listVoiceSessions } from '../voice-history.js';
import { createVoiceClientHarness, PLAN_PAYLOAD } from './helpers/voice-client-harness.mjs';

const user = text => ({ speaker: 'user', text });
const question = text => ({ speaker: 'assistant', text });
// Synthetic words keep boundary tests exact; the content-quality judgment is
// separately grounded below and still requires recorded model acceptance.
const words = (count, prefix) => Array.from({ length: count }, (_, i) => prefix + i).join(' ');
const enough = [question('First example?'), user(words(100, 'first')),
  question('Second example?'), user(words(100, 'second')),
  question('Third example?'), user(words(100, 'third'))];
const short = [question('How did you verify the process?'), user(
  'I observed the process and compared the records with what people actually did. The records were consistent with those observations. I also asked the operators to explain how they handled exceptions, and checked their explanations against the recorded steps. The comparison gave us a useful starting point for reviewing the process together.'
)];

function mockScorer(t, card) {
  const original = globalThis.fetch;
  let request;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: JSON.stringify(card) }, finish_reason: 'stop' }], usage: {} });
  };
  return () => request;
}
const numericCard = {
  overall: 66, dimensions: { communication: 66, structure: 66, contentDepth: 66, roleFit: 66 },
  saoBalance: { situation: 25, action: 50, outcome: 25 },
  topStrength: 'You checked the records against observations.', topImprovement: 'Describe one decision that followed the check.',
  summary: 'Practice explaining the decision and result.', moments: [],
  competencies: ['first', 'second', 'third'].map(prefix => ({
    name: prefix, status: 'demonstrated', quote: words(5, prefix), feedback: 'Supported by this example.'
  }))
};

test('grading requires both enough candidate words and three substantive answers', () => {
  assert.deepEqual(scoreEvidence(enough), { candidateWords: 300, substantiveAnswers: 3, eligible: true });
  assert.equal(scoreEvidence(enough.slice(0, -1).concat(user(words(99, 'third')))).eligible, false);
  assert.equal(scoreEvidence([question('One example?'), user(words(400, 'one'))]).eligible, false);
  assert.equal(scoreEvidence([question('One?'), user(words(140, 'one')), question('Two?'), user(words(140, 'two')),
    question('Three?'), user(words(20, 'three'))]).eligible, false);
});

test('transcription fragments, duplicate answers, interviewer words and session controls do not inflate eligibility', () => {
  assert.equal(scoreEvidence([question('Describe it?'), ...Array.from({ length: 6 }, (_, i) => user(words(50, 'chunk' + i)))]).substantiveAnswers, 1);
  assert.deepEqual(scoreEvidence(Array.from({ length: 3 }, () => [question('More?'), user(words(150, 'same'))]).flat()),
    { candidateWords: 150, substantiveAnswers: 1, eligible: false });
  assert.deepEqual(scoreEvidence([question(words(500, 'interviewer')), user('Can you hear me?'), user("I'd like to end this now."), user('I gotta go. Bye-bye.')]),
    { candidateWords: 0, substantiveAnswers: 0, eligible: false });
});

test('candidate labels cannot push a tiny answer across the model-call threshold', async () => {
  const result = await scoreVoiceTranscript({ role: 'Analyst', transcript: [user('a'.repeat(190))] }, {});
  assert.equal(result.scorecard.tooShort, true);
  assert.equal(result.model, null);
});

test('a limited sample requests qualitative feedback and strips unexpected provider numbers', async t => {
  const request = mockScorer(t, { ...numericCard, competencies: [{ name: 'Verification', status: 'demonstrated',
    quote: 'The records were consistent with those observations.', feedback: 'You verified the stated process.' }] });
  const { scorecard } = await scoreVoiceTranscript({ role: 'Process specialist', transcript: short }, { OPENAI_API_KEY: 'test-fixture' });
  assert.equal(request().response_format.json_schema.name, 'voice_interview_feedback');
  for (const key of ['overall', 'dimensions', 'saoBalance']) {
    assert.equal(request().response_format.json_schema.schema.properties[key].type, 'null');
    assert.equal(scorecard[key], null);
  }
  assert.equal(scorecard.feedbackOnly, true);
  assert.equal(scorecard.scoreEligibility.eligible, false);
  assert.equal(scorecard.topImprovement, numericCard.topImprovement);
  assert.equal(scorecard.competencies[0].status, 'demonstrated');
});

test('eligible evidence with three grounded assessments retains practice numbers', async t => {
  const request = mockScorer(t, numericCard);
  const { scorecard } = await scoreVoiceTranscript({ role: 'Analyst', transcript: enough }, { OPENAI_API_KEY: 'test-fixture' });
  assert.equal(request().response_format.json_schema.name, 'voice_interview_scorecard');
  assert.equal(scorecard.scoreEligibility.eligible, true);
  assert.equal(scorecard.overall, 66);
  assert.ok(!scorecard.feedbackOnly);
});

test('enough words with ungrounded assessments still cannot produce a numerical score', async t => {
  mockScorer(t, { ...numericCard, competencies: numericCard.competencies.map(c => ({ ...c, quote: 'Invented evidence.' })) });
  const { scorecard } = await scoreVoiceTranscript({ role: 'Analyst', transcript: enough }, { OPENAI_API_KEY: 'test-fixture' });
  assert.equal(scorecard.feedbackOnly, true);
  assert.equal(scorecard.overall, null);
  assert.ok(scorecard.competencies.every(c => c.status === 'not_assessed'));
});

test('free report and paid history suppress numbers on a feedback-only card, while legacy reports retain them', async () => {
  const feedback = { ...numericCard, feedbackOnly: true };
  assert.equal(partialScorecard(feedback).overall, null);
  assert.equal(partialScorecard(feedback).feedbackOnly, true);
  const rows = [feedback, numericCard].map((card, i) => ({ id: 'evidence-' + i, role: 'Analyst', status: 'completed',
    entitlement_mode: 'pack', started_at: new Date().toISOString(), scorecard_json: JSON.stringify(card) }));
  const env = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) } };
  const history = await listVoiceSessions(env, 1, { hasEverPaid: true, mode: 'pack', sessionsRemaining: 4 });
  assert.equal(history[0].status, 'ready');
  assert.equal(history[0].overall, null);
  assert.equal(history[0].topImprovement, numericCard.topImprovement);
  assert.equal(history[1].overall, 66);
});

for (const invalidSource of ['competency', 'moment']) {
  test(`rejected ${invalidSource} evidence removes dependent claims even with three valid assessments`, async t => {
    const unsupported = 'You ignored the safety procedure.';
    const card = { ...numericCard,
      assessmentScope: unsupported, topStrength: unsupported,
      topImprovement: unsupported, summary: unsupported, saoCoaching: [unsupported],
      competencies: [...numericCard.competencies], moments: [] };
    if (invalidSource === 'competency') card.competencies.push({
      name: 'Safety', status: 'needs_practice', quote: 'I ignored the safety procedure.', feedback: unsupported
    });
    else card.moments.push({ quote: 'I ignored the safety procedure.', comment: unsupported });
    mockScorer(t, card);
    const { scorecard } = await scoreVoiceTranscript({ role: 'Analyst', transcript: enough }, { OPENAI_API_KEY: 'test-fixture' });
    assert.equal(scorecard.evidenceLimited, true);
    assert.equal(scorecard.feedbackOnly, true);
    assert.equal(scorecard.overall, null);
    assert.equal(scorecard.dimensions, null);
    assert.equal(scorecard.saoBalance, null);
    assert.equal(scorecard.competencies.filter(c => c.status !== 'not_assessed').length, 3);
    assert.doesNotMatch(JSON.stringify(scorecard), /ignored the safety procedure/);
    assert.doesNotMatch(JSON.stringify(partialScorecard(scorecard)), /ignored the safety procedure/);
    assert.equal(partialScorecard(scorecard).evidenceLimited, true);
    for (const fullAccess of [true, false]) {
      const h = createVoiceClientHarness({ search: '?session=rejected', routes: {
        '/api/plan/me': () => PLAN_PAYLOAD, '/api/voice/sessions': () => ({ sessions: [] }),
        '/api/voice/session/': () => ({ sessionId: 'rejected', status: 'completed', fullAccess, scorecardReady: true,
          scorecard: fullAccess ? scorecard : partialScorecard(scorecard) })
      } });
      try {
        await h.ready();
        const html = h.el('vi-scorecard').innerHTML;
        assert.match(html, /could not verify all of the supporting evidence/);
        assert.match(html, /report limitation, not a judgment of your ability/);
        assert.doesNotMatch(html, /need more substantive answers|verified excerpts below|ignored the safety procedure/);
        assert.doesNotMatch(html, /Practice score details|vi-sc-score|vi-sc-dims/);
      } finally { h.dispose(); }
    }
  });
}

for (const fullAccess of [true, false]) {
  test(`${fullAccess ? 'paid' : 'free'} limited report keeps useful feedback without score displays or score upsells`, async t => {
    const h = createVoiceClientHarness({ search: '?session=limited', routes: {
      '/api/plan/me': () => PLAN_PAYLOAD, '/api/voice/sessions': () => ({ sessions: [] }),
      '/api/voice/session/': () => ({ sessionId: 'limited', status: 'completed', fullAccess, scorecardReady: true,
        scorecard: { ...numericCard, feedbackOnly: true } })
    } });
    t.after(() => h.dispose()); await h.ready();
    const html = h.el('vi-scorecard').innerHTML;
    assert.match(html, /Feedback only for this sample/);
    assert.match(html, /Describe one decision/);
    assert.doesNotMatch(html, /Practice score details|vi-sc-score|vi-sc-dims|<span>Communication<\/span>/);
    if (!fullAccess) assert.match(html, /Evidence from your answers/);
  });
}
