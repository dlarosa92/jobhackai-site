// Deterministic helpers for the transcript evaluation harness:
// fixture loading, case selection, expectation checking, aggregation,
// stability statistics, and cost estimation.

import { readFileSync } from 'node:fs';
import { conceptAppears, coachingText, allFeedbackText } from './concepts.mjs';

export function loadFixtures(jsonlPath) {
  return readFileSync(jsonlPath, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line));
}

export function inRange(value, [lo, hi]) {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi;
}

/**
 * Smoke set: one fixture per archetype, quality level rotating with the
 * archetype index so all five levels are represented.
 */
export function selectSmokeCases(fixtures) {
  const qualities = ['excellent', 'good', 'average', 'weak', 'poor'];
  const archetypes = [...new Set(fixtures.map(f => f.archetype))];
  return archetypes.map((arch, i) => {
    const quality = qualities[i % qualities.length];
    const match = fixtures.find(f => f.archetype === arch && f.qualityLevel === quality);
    if (!match) throw new Error(`No fixture for ${arch}/${quality}`);
    return match;
  });
}

/**
 * Stability set: 10 fixed cases spanning behavior extremes.
 */
export const STABILITY_CASE_IDS = [
  'strong-star--excellent',
  'measurable-results--good',
  'missing-outcome--good',
  'vague--average',
  'irrelevant--average',
  'excessive-background--good',
  'short-answers--weak',
  'nervous--average',
  'senior-leadership--excellent',
  'conflicting-claims--good'
];

export function selectStabilityCases(fixtures) {
  return STABILITY_CASE_IDS.map(id => {
    const match = fixtures.find(f => f.id === id);
    if (!match) throw new Error(`No fixture with id ${id}`);
    return match;
  });
}

/**
 * Convert a fixture transcript (interviewer/candidate speakers, kept
 * readable in JSONL) to the production voice-session transcript format
 * ({ speaker: 'assistant'|'user' }), as stored by
 * /api/voice/session/:id/complete.
 */
export function toVoiceTranscript(transcript) {
  return (transcript || []).map(t => ({
    speaker: t.speaker === 'interviewer' ? 'assistant' : 'user',
    text: t.text
  }));
}

/**
 * Check a voice scorecard against a fixture's expectations.
 * Returns { passed, failures: [{ category, message }] }.
 */
export function evaluateCase(fixture, scorecard) {
  const failures = [];
  const exp = fixture.expectations;

  const check = (category, value, range, label) => {
    if (!range) return;
    if (!inRange(value, range)) {
      failures.push({
        category,
        message: `${label} = ${value}, expected within [${range[0]}, ${range[1]}]`
      });
    }
  };

  check('overall-range', scorecard.overall, exp.overallScore, 'overall');
  check('structure-range', scorecard.dimensions?.structure, exp.structureScore, 'dimensions.structure');
  if (exp.roleFitScore) {
    check('rolefit-range', scorecard.dimensions?.roleFit, exp.roleFitScore, 'dimensions.roleFit');
  }
  check('sao-range', scorecard.saoBalance?.situation, exp.sao?.situation, 'saoBalance.situation');
  check('sao-range', scorecard.saoBalance?.action, exp.sao?.action, 'saoBalance.action');
  check('sao-range', scorecard.saoBalance?.outcome, exp.sao?.outcome, 'saoBalance.outcome');

  const coaching = coachingText(scorecard);
  for (const group of exp.feedbackMustMention || []) {
    const ids = Array.isArray(group) ? group : [group];
    if (!ids.some(id => conceptAppears(id, coaching))) {
      failures.push({
        category: 'missing-concept',
        message: `Coaching feedback mentions none of: ${ids.join(', ')}`
      });
    }
  }

  const everything = allFeedbackText(scorecard);
  for (const id of exp.feedbackMustNotMention || []) {
    if (conceptAppears(id, everything)) {
      failures.push({
        category: 'forbidden-concept',
        message: `Feedback contains forbidden concept: ${id}`
      });
    }
  }

  return { passed: failures.length === 0, failures };
}

export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map(v => (v - m) ** 2)));
}

/**
 * Per-case stability stats from repeated runs of the same fixture.
 */
export function stabilityStats(runs) {
  const overall = runs.map(r => r.scorecard.overall);
  const outcome = runs.map(r => r.scorecard.saoBalance?.outcome ?? 0);
  return {
    runs: runs.length,
    overall: {
      mean: round2(mean(overall)),
      stddev: round2(stddev(overall)),
      spread: round2(Math.max(...overall) - Math.min(...overall))
    },
    outcomePct: {
      mean: round2(mean(outcome)),
      stddev: round2(stddev(outcome)),
      spread: round2(Math.max(...outcome) - Math.min(...outcome))
    }
  };
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

// Mirrors the pricing table in app/functions/_lib/openai-client.js.
export const MODEL_PRICING_PER_TOKEN = {
  'gpt-4.1-mini': { input: 0.4 / 1_000_000, output: 1.6 / 1_000_000 },
  'gpt-4.1': { input: 2.0 / 1_000_000, output: 8.0 / 1_000_000 },
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  'gpt-4o': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 }
};

/**
 * Estimated USD cost of a call; null when the model is unknown or usage
 * is unavailable.
 */
export function estimateCostUsd(model, usage) {
  if (!usage || typeof model !== 'string') return null;
  // Longest matching prefix wins (gpt-4.1-mini before gpt-4.1).
  const match = Object.keys(MODEL_PRICING_PER_TOKEN)
    .filter(k => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  const pricing = MODEL_PRICING_PER_TOKEN[match];
  if (!pricing) return null;
  const cost = (usage.promptTokens || 0) * pricing.input
    + (usage.completionTokens || 0) * pricing.output;
  return Math.round(cost * 10000) / 10000;
}

/**
 * Aggregate case results into report-ready summary data.
 */
export function aggregateResults(results) {
  const completed = results.filter(r => !r.error);
  const errored = results.filter(r => r.error);
  const passed = completed.filter(r => r.evaluation.passed);
  const failed = completed.filter(r => !r.evaluation.passed);

  const failuresByCategory = {};
  for (const r of failed) {
    for (const f of r.evaluation.failures) {
      failuresByCategory[f.category] = (failuresByCategory[f.category] || 0) + 1;
    }
  }
  if (errored.length > 0) {
    failuresByCategory['api-error'] = errored.length;
  }

  const byQuality = {};
  for (const r of completed) {
    const q = r.fixture.qualityLevel;
    byQuality[q] = byQuality[q] || { overall: [], structure: [], outcomePct: [] };
    byQuality[q].overall.push(r.scorecard.overall);
    byQuality[q].structure.push(r.scorecard.dimensions?.structure ?? 0);
    byQuality[q].outcomePct.push(r.scorecard.saoBalance?.outcome ?? 0);
  }
  const averagesByQuality = {};
  for (const [q, vals] of Object.entries(byQuality)) {
    averagesByQuality[q] = {
      cases: vals.overall.length,
      avgOverall: round2(mean(vals.overall)),
      avgStructure: round2(mean(vals.structure)),
      avgOutcomePct: round2(mean(vals.outcomePct))
    };
  }

  const usages = completed.map(r => r.usage).filter(Boolean);
  const totalTokens = usages.reduce((a, u) => a + (u.totalTokens || 0), 0);
  const promptTokens = usages.reduce((a, u) => a + (u.promptTokens || 0), 0);
  const completionTokens = usages.reduce((a, u) => a + (u.completionTokens || 0), 0);
  const costs = completed
    .map(r => estimateCostUsd(r.model, r.usage))
    .filter(c => typeof c === 'number');
  const estimatedCostUsd = costs.length > 0
    ? Math.round(costs.reduce((a, b) => a + b, 0) * 10000) / 10000
    : null;

  return {
    totalCases: results.length,
    passed: passed.length,
    failed: failed.length + errored.length,
    apiErrors: errored.length,
    passRate: results.length > 0 ? round2((passed.length / results.length) * 100) : 0,
    failuresByCategory,
    averagesByQuality,
    tokenUsage: usages.length > 0 ? { totalTokens, promptTokens, completionTokens } : null,
    estimatedCostUsd
  };
}
