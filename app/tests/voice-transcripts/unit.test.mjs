// Deterministic unit tests for the voice transcript evaluation harness.
// No network calls. Run with: npm run test:voice:transcripts:unit

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  transcriptToText, scoreVoiceTranscript, MIN_SCOREABLE_CHARS
} from '../../functions/_lib/voice-scorecard.js';
import { conceptAppears, coachingText, allFeedbackText, CONCEPTS } from './lib/concepts.mjs';
import {
  loadFixtures, inRange, selectSmokeCases, selectStabilityCases, toVoiceTranscript,
  evaluateCase, mean, stddev, stabilityStats, estimateCostUsd, aggregateResults
} from './lib/eval-utils.mjs';
import { coherenceChecks, quoteFidelity } from './lib/coherence.mjs';
import { generateFixtures } from './fixtures/generate-fixtures.mjs';
import { ARCHETYPES, QUALITY_LEVELS } from './fixtures/archetypes.mjs';

const FIXTURES_PATH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcripts.jsonl');

function sampleScorecard(overrides = {}) {
  return {
    overall: 74,
    dimensions: { communication: 72, structure: 68, contentDepth: 70, roleFit: 78 },
    saoBalance: { situation: 15, action: 25, outcome: 60 },
    saoCoaching: [
      'Open answers with the result. Then explain how.',
      'Quantify outcomes with numbers wherever you can.'
    ],
    topStrength: 'You backed your answers with measurable outcomes.',
    topImprovement: 'Trim the background setup and get to the outcome sooner.',
    moments: [
      { quote: 'P95 latency dropped from 2.1 seconds to 180 milliseconds', comment: 'Strong, specific metric. Keep leading with results like this.' }
    ],
    summary: 'You told clear stories with real results. Spend less time on context and more on outcomes to score higher.',
    ...overrides
  };
}

export function testTranscriptToText() {
  const text = transcriptToText([
    { speaker: 'assistant', text: 'Tell me about a tight deadline.' },
    { speaker: 'user', text: 'I shipped a fix before a holiday sale.' },
    { speaker: 'user', text: 'ok' } // too short after prefixing — filtered
  ]);
  assert.strictEqual(
    text,
    'INTERVIEWER: Tell me about a tight deadline.\nCANDIDATE: I shipped a fix before a holiday sale.'
  );
  assert.strictEqual(transcriptToText(null), '');
  assert.strictEqual(transcriptToText([]), '');
}

export async function testScoreVoiceTranscriptTooShortPath() {
  // Below MIN_SCOREABLE_CHARS the production function returns the fixed
  // "too short" scorecard without calling the API (env has no key).
  const result = await scoreVoiceTranscript({
    role: 'Software Engineer',
    seniority: 'Mid-level',
    transcript: [{ speaker: 'user', text: 'Hello? Is this on?' }]
  }, {});
  assert.strictEqual(result.scorecard.tooShort, true);
  assert.strictEqual(result.scorecard.overall, 0);
  assert.strictEqual(result.usage, null);
  assert.ok(MIN_SCOREABLE_CHARS === 200);
}

export function testToVoiceTranscript() {
  assert.deepStrictEqual(
    toVoiceTranscript([
      { speaker: 'interviewer', text: 'Q?' },
      { speaker: 'candidate', text: 'A.' }
    ]),
    [
      { speaker: 'assistant', text: 'Q?' },
      { speaker: 'user', text: 'A.' }
    ]
  );
  assert.deepStrictEqual(toVoiceTranscript(null), []);
}

export function testConceptMatching() {
  assert.ok(conceptAppears('outcome-focus', 'Quantify the impact of your work.'));
  assert.ok(conceptAppears('specificity', 'The answer was too vague.'));
  assert.ok(conceptAppears('relevance-concern', 'The response did not address the question.'));
  assert.ok(conceptAppears('consistency', 'The claims contradict each other.'));
  assert.ok(conceptAppears('confidence', 'Reduce filler words to sound more confident.'));
  assert.ok(conceptAppears('ownership', 'Clarify your individual contribution.'));
  assert.ok(conceptAppears('real-example', 'Use a real example instead of a hypothetical.'));

  // Forbidden concept: model claims no outcome was provided
  assert.ok(conceptAppears('claims-no-outcome', 'The candidate provided no measurable outcome.'));
  assert.ok(conceptAppears('claims-no-outcome', "You didn't provide a clear result for the project."));
  assert.ok(conceptAppears('claims-no-outcome', 'Outcomes were missing from most answers.'));
  // ...but coaching that praises or encourages outcomes must NOT match
  assert.ok(!conceptAppears('claims-no-outcome', "Don't forget to quantify outcomes."));
  assert.ok(!conceptAppears('claims-no-outcome', 'Strong measurable outcomes in every answer.'));
  assert.ok(!conceptAppears('claims-no-outcome', 'Open answers with the result. Then explain how.'));
  // ...nor critiques of OTHER missing elements that merely mention results
  // (real false positives from full runs)
  assert.ok(!conceptAppears('claims-no-outcome', 'Without more context, the results are hard to assess.'));
  assert.ok(!conceptAppears('claims-no-outcome', 'You are missing the situation setup before your results.'));
  assert.ok(!conceptAppears('claims-no-outcome', 'Your results are missing the story behind them.'));
  assert.ok(!conceptAppears('claims-no-outcome', 'The result is missing its supporting actions.'));
  // ...while genuine "results were absent" claims still match
  assert.ok(conceptAppears('claims-no-outcome', 'Concrete outcomes were missing from most answers.'));
  assert.ok(conceptAppears('claims-no-outcome', 'The results were not stated anywhere.'));

  assert.ok(conceptAppears('praises-relevance', 'The answers were highly relevant to the role.'));
  assert.ok(!conceptAppears('praises-relevance', 'Work on making answers more relevant.'));

  assert.throws(() => conceptAppears('nonexistent-concept', 'text'));
}

export function testFeedbackTextExtraction() {
  const sc = sampleScorecard();
  const coaching = coachingText(sc);
  assert.ok(coaching.includes('Quantify outcomes with numbers wherever you can.'));
  assert.ok(coaching.includes('Trim the background setup and get to the outcome sooner.'));
  assert.ok(coaching.includes('Keep leading with results like this.'));
  assert.ok(coaching.includes('Spend less time on context'));
  // topStrength excluded from coaching text but present in full text
  assert.ok(!coaching.includes('You backed your answers with measurable outcomes.'));
  assert.ok(allFeedbackText(sc).includes('You backed your answers with measurable outcomes.'));
  // Candidate quotes are never scanned
  assert.ok(!allFeedbackText(sc).includes('P95 latency dropped'));
}

export function testInRange() {
  assert.ok(inRange(5, [0, 10]));
  assert.ok(inRange(0, [0, 10]));
  assert.ok(inRange(10, [0, 10]));
  assert.ok(!inRange(11, [0, 10]));
  assert.ok(!inRange(NaN, [0, 10]));
  assert.ok(!inRange('5', [0, 10]));
}

export function testEvaluateCase() {
  const fixture = {
    expectations: {
      overallScore: [60, 100],
      structureScore: [30, 100],
      sao: { situation: [0, 100], action: [0, 100], outcome: [30, 100] },
      feedbackMustMention: [['outcome-focus']],
      feedbackMustNotMention: ['claims-no-outcome']
    }
  };
  const pass = evaluateCase(fixture, sampleScorecard());
  assert.strictEqual(pass.passed, true, JSON.stringify(pass.failures));

  // Out-of-range outcome + forbidden concept both flagged
  const bad = sampleScorecard({
    saoBalance: { situation: 60, action: 30, outcome: 10 },
    saoCoaching: ['No measurable outcome was provided in any answer.', 'Add results.']
  });
  const fail = evaluateCase(fixture, bad);
  assert.strictEqual(fail.passed, false);
  const categories = fail.failures.map(f => f.category);
  assert.ok(categories.includes('sao-range'));
  assert.ok(categories.includes('forbidden-concept'));

  // Missing required concept
  const noCoach = sampleScorecard({
    saoCoaching: ['Smile more.', 'Speak slower.'],
    topImprovement: 'Be more animated.',
    moments: [],
    summary: 'A pleasant conversation.'
  });
  const fail2 = evaluateCase(fixture, noCoach);
  assert.ok(fail2.failures.some(f => f.category === 'missing-concept'));

  // roleFit range enforced when the fixture demands it
  const roleFitFixture = {
    expectations: {
      overallScore: [0, 100],
      structureScore: [0, 100],
      sao: { situation: [0, 100], action: [0, 100], outcome: [0, 100] },
      roleFitScore: [0, 40],
      feedbackMustMention: [],
      feedbackMustNotMention: []
    }
  };
  const fail3 = evaluateCase(roleFitFixture, sampleScorecard()); // roleFit 78
  assert.ok(fail3.failures.some(f => f.category === 'rolefit-range'));
}

export function testCoherenceChecks() {
  const CANDIDATE_TEXT = 'P95 latency dropped from 2.1 seconds to 180 milliseconds and we shipped before the sale.';

  // A coherent scorecard produces zero failures.
  assert.deepStrictEqual(coherenceChecks(sampleScorecard(), CANDIDATE_TEXT), []);

  // Too-short scorecards are exempt (fixed template).
  assert.deepStrictEqual(coherenceChecks({ tooShort: true, overall: 0 }, CANDIDATE_TEXT), []);

  const cats = (sc, text = CANDIDATE_TEXT) => coherenceChecks(sc, text).map(f => f.category);

  // 1. coherence-halo: high outcome share + "no outcome" feedback
  assert.ok(cats(sampleScorecard({
    saoCoaching: ['No measurable outcome was provided.', 'Add results.']
  })).includes('coherence-halo'));

  // 2. coherence-formula: structure must track outcome share both ways
  assert.ok(cats(sampleScorecard({
    dimensions: { communication: 70, structure: 80, contentDepth: 70, roleFit: 70 },
    saoBalance: { situation: 30, action: 30, outcome: 40 }
  })).includes('coherence-formula'));
  assert.ok(cats(sampleScorecard({
    dimensions: { communication: 70, structure: 35, contentDepth: 70, roleFit: 70 },
    saoBalance: { situation: 25, action: 25, outcome: 50 }
  })).includes('coherence-formula'));

  // 3. coherence-rolefit: very low roleFit (<= 30, the prompt's irrelevance
  // anchor) needs relevance OR specificity coaching; high roleFit must not
  // raise a relevance concern.
  const blandCoaching = {
    saoCoaching: ['Smile more.', 'Speak slower.'],
    topImprovement: 'Be more animated.',
    moments: [],
    summary: 'A pleasant conversation.'
  };
  assert.ok(cats(sampleScorecard({
    ...blandCoaching,
    dimensions: { communication: 70, structure: 68, contentDepth: 70, roleFit: 25 }
  })).includes('coherence-rolefit'));
  // roleFit 35 (weak-but-on-topic zone) no longer triggers the rule
  assert.ok(!cats(sampleScorecard({
    ...blandCoaching,
    dimensions: { communication: 70, structure: 68, contentDepth: 70, roleFit: 35 }
  })).includes('coherence-rolefit'));
  // specificity coaching satisfies the rule at roleFit <= 30
  assert.ok(!cats(sampleScorecard({
    ...blandCoaching,
    dimensions: { communication: 70, structure: 68, contentDepth: 70, roleFit: 25 },
    topImprovement: 'Give specific examples from real projects next time.'
  })).includes('coherence-rolefit'));
  assert.ok(cats(sampleScorecard({
    topImprovement: 'Your answers were off-topic; stay relevant to the question.'
  })).includes('coherence-rolefit')); // roleFit 78 in sample

  // 4. coherence-outcome-coaching: tiny outcome share demands outcome coaching
  assert.ok(cats(sampleScorecard({
    saoBalance: { situation: 60, action: 25, outcome: 15 },
    dimensions: { communication: 70, structure: 40, contentDepth: 70, roleFit: 70 },
    saoCoaching: ['Smile more.', 'Speak slower.'],
    topImprovement: 'Be more animated.',
    moments: [],
    summary: 'A pleasant conversation.'
  })).includes('coherence-outcome-coaching'));

  // 5. lint-sao-sum
  assert.ok(cats(sampleScorecard({
    saoBalance: { situation: 10, action: 10, outcome: 20 },
    dimensions: { communication: 70, structure: 30, contentDepth: 70, roleFit: 70 }
  })).includes('lint-sao-sum'));

  // 6. lint-coaching-shape: wrong count or over-length tips
  assert.ok(cats(sampleScorecard({ saoCoaching: ['Only one tip.'] })).includes('lint-coaching-shape'));
  assert.ok(cats(sampleScorecard({
    saoCoaching: ['Fine tip.', 'x'.repeat(120)]
  })).includes('lint-coaching-shape'));

  // 7. lint-quote-fidelity: fabricated quotes are caught; real ones pass; no transcript = skipped
  assert.ok(cats(sampleScorecard({
    moments: [{ quote: 'increased quarterly revenue seventeen percent across Europe', comment: 'Great metric.' }]
  })).includes('lint-quote-fidelity'));
  assert.ok(!cats(sampleScorecard()).includes('lint-quote-fidelity'));
  assert.ok(!cats(sampleScorecard({
    moments: [{ quote: 'totally fabricated words here', comment: 'x' }]
  }), null).includes('lint-quote-fidelity'));

  // 8. personability-robotic
  assert.ok(cats(sampleScorecard({
    summary: 'In summary, the candidate demonstrates ability but should improve outcomes.'
  })).includes('personability-robotic'));

  assert.strictEqual(quoteFidelity('', 'anything'), 1);
  assert.strictEqual(quoteFidelity('latency dropped milliseconds', CANDIDATE_TEXT), 1);
}

export function testStats() {
  assert.strictEqual(mean([2, 4, 6]), 4);
  assert.strictEqual(mean([]), 0);
  assert.strictEqual(stddev([5, 5, 5]), 0);
  assert.ok(Math.abs(stddev([2, 4, 6]) - 1.633) < 0.01);

  const runs = [70, 75, 80].map(overall => ({
    scorecard: { overall, saoBalance: { outcome: 50 } }
  }));
  const stats = stabilityStats(runs);
  assert.strictEqual(stats.runs, 3);
  assert.strictEqual(stats.overall.mean, 75);
  assert.strictEqual(stats.overall.spread, 10);
  assert.strictEqual(stats.outcomePct.stddev, 0);
}

export function testEstimateCostUsd() {
  const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000 };
  assert.strictEqual(estimateCostUsd('gpt-4.1', usage), 10);
  assert.strictEqual(estimateCostUsd('gpt-4.1-mini', usage), 2);
  // Dated model IDs resolve via longest prefix
  assert.strictEqual(estimateCostUsd('gpt-4.1-mini-2025-04-14', usage), 2);
  assert.strictEqual(estimateCostUsd('unknown-model', usage), null);
  assert.strictEqual(estimateCostUsd('gpt-4.1', null), null);
}

export function testFixtureDataset() {
  const fixtures = loadFixtures(FIXTURES_PATH);
  assert.strictEqual(fixtures.length, 100, 'Dataset must contain exactly 100 cases');

  const ids = new Set(fixtures.map(f => f.id));
  assert.strictEqual(ids.size, 100, 'Fixture IDs must be unique');

  // Balanced matrix: 20 archetypes x 5 quality levels
  const archetypes = new Set(fixtures.map(f => f.archetype));
  assert.strictEqual(archetypes.size, 20);
  for (const arch of archetypes) {
    const qualities = fixtures.filter(f => f.archetype === arch).map(f => f.qualityLevel).sort();
    assert.deepStrictEqual(qualities, [...QUALITY_LEVELS].sort(), `Archetype ${arch} must cover all 5 quality levels`);
  }

  for (const f of fixtures) {
    assert.ok(f.role && f.seniority, `${f.id}: role and seniority required`);
    assert.ok(Array.isArray(f.transcript) && f.transcript.length === 6, `${f.id}: 3 Q&A turn pairs expected`);
    for (let i = 0; i < f.transcript.length; i++) {
      const turn = f.transcript[i];
      assert.strictEqual(turn.speaker, i % 2 === 0 ? 'interviewer' : 'candidate', `${f.id}: turns must alternate`);
      assert.ok(turn.text.trim().length > 0, `${f.id}: non-empty turn text`);
    }

    // Every fixture must exceed the production too-short threshold,
    // otherwise the harness would exercise the fallback path, not scoring.
    const text = transcriptToText(toVoiceTranscript(f.transcript));
    assert.ok(text.length >= 200, `${f.id}: transcript long enough to be scored (${text.length} chars)`);

    const e = f.expectations;
    const assertRange = (r, lo, hi, label) => {
      assert.ok(Array.isArray(r) && r.length === 2, `${f.id}: ${label} is a [lo, hi] range`);
      assert.ok(r[0] <= r[1] && r[0] >= lo && r[1] <= hi, `${f.id}: ${label} ${JSON.stringify(r)} within [${lo}, ${hi}]`);
    };
    assertRange(e.overallScore, 0, 100, 'overallScore');
    assertRange(e.structureScore, 0, 100, 'structureScore');
    assertRange(e.sao.situation, 0, 100, 'sao.situation');
    assertRange(e.sao.action, 0, 100, 'sao.action');
    assertRange(e.sao.outcome, 0, 100, 'sao.outcome');
    if (e.roleFitScore) assertRange(e.roleFitScore, 0, 100, 'roleFitScore');

    for (const group of e.feedbackMustMention) {
      for (const id of (Array.isArray(group) ? group : [group])) {
        assert.ok(CONCEPTS[id], `${f.id}: unknown must-mention concept "${id}"`);
      }
    }
    for (const id of e.feedbackMustNotMention) {
      assert.ok(CONCEPTS[id], `${f.id}: unknown must-not-mention concept "${id}"`);
    }
  }

  // Checked-in dataset matches the generator (regenerate if this fails)
  const regenerated = generateFixtures();
  assert.deepStrictEqual(fixtures, regenerated, 'transcripts.jsonl is stale — re-run generate-fixtures.mjs');
}

export function testTaskListedBehaviorsAreCovered() {
  const ids = new Set(ARCHETYPES.map(a => a.id));
  for (const required of [
    'strong-star', 'weak-generic', 'missing-outcome', 'vague',
    'excessive-background', 'excessive-process', 'measurable-results',
    'conflicting-claims', 'short-answers', 'rambling', 'senior-leadership',
    'technical-deep-dive', 'nervous', 'irrelevant'
  ]) {
    assert.ok(ids.has(required), `Missing required archetype: ${required}`);
  }
}

export function testCaseSelection() {
  const fixtures = loadFixtures(FIXTURES_PATH);
  const smoke = selectSmokeCases(fixtures);
  assert.strictEqual(smoke.length, 20);
  assert.strictEqual(new Set(smoke.map(f => f.archetype)).size, 20, 'Smoke covers every archetype');
  assert.strictEqual(new Set(smoke.map(f => f.qualityLevel)).size, 5, 'Smoke covers every quality level');
  assert.deepStrictEqual(selectSmokeCases(fixtures), smoke, 'Selection is deterministic');

  const stability = selectStabilityCases(fixtures);
  assert.strictEqual(stability.length, 10);
  assert.strictEqual(new Set(stability.map(f => f.id)).size, 10);
}

export function testAggregateResults() {
  const fixtures = loadFixtures(FIXTURES_PATH).slice(0, 3);
  const results = [
    {
      fixture: fixtures[0],
      scorecard: sampleScorecard(),
      usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      model: 'gpt-4.1-mini',
      evaluation: { passed: true, failures: [] }
    },
    {
      fixture: fixtures[1],
      scorecard: sampleScorecard({ overall: 40 }),
      usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      model: 'gpt-4.1-mini',
      evaluation: { passed: false, failures: [{ category: 'overall-range', message: 'x' }] }
    },
    { fixture: fixtures[2], error: 'HTTP 500' }
  ];
  const summary = aggregateResults(results);
  assert.strictEqual(summary.totalCases, 3);
  assert.strictEqual(summary.passed, 1);
  assert.strictEqual(summary.failed, 2);
  assert.strictEqual(summary.apiErrors, 1);
  assert.strictEqual(summary.passRate, 33.33);
  assert.strictEqual(summary.failuresByCategory['overall-range'], 1);
  assert.strictEqual(summary.failuresByCategory['api-error'], 1);
  assert.strictEqual(summary.tokenUsage.totalTokens, 3000);
  assert.ok(summary.estimatedCostUsd > 0);
}

const TESTS = [
  testTranscriptToText,
  testScoreVoiceTranscriptTooShortPath,
  testToVoiceTranscript,
  testConceptMatching,
  testFeedbackTextExtraction,
  testInRange,
  testEvaluateCase,
  testCoherenceChecks,
  testStats,
  testEstimateCostUsd,
  testFixtureDataset,
  testTaskListedBehaviorsAreCovered,
  testCaseSelection,
  testAggregateResults
];

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    let failed = 0;
    for (const test of TESTS) {
      try {
        await test();
        console.log(`  ✓ ${test.name}`);
      } catch (err) {
        failed++;
        console.error(`  ✗ ${test.name}`);
        console.error(`    ${err.message}`);
      }
    }
    if (failed > 0) {
      console.error(`\n❌ ${failed}/${TESTS.length} voice transcript unit tests failed.`);
      process.exit(1);
    }
    console.log(`\n✅ All ${TESTS.length} voice transcript unit tests passed.`);
  })();
}
