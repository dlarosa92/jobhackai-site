#!/usr/bin/env node
// Local transcript evaluation harness for the voice interview scorecard.
// Makes REAL OpenAI calls — local, opt-in only. See README.md.
//
// Usage:
//   node app/tests/voice-transcripts/run-evals.mjs --mode smoke|full|stability
//
// Requires OPENAI_API_KEY. Optional: OPENAI_MODEL_VOICE_SCORE (defaults to
// the same model the production scorecard uses).

import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scoreVoiceTranscript } from '../../functions/_lib/voice-scorecard.js';
import {
  loadFixtures, selectSmokeCases, selectStabilityCases, toVoiceTranscript,
  evaluateCase, aggregateResults, stabilityStats, round2, mean
} from './lib/eval-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(HERE, 'fixtures', 'transcripts.jsonl');
const REPORTS_DIR = join(HERE, 'reports');

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;
const STABILITY_RUNS = 3;

function parseArgs(argv) {
  const args = { mode: 'smoke' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode' && argv[i + 1]) args.mode = argv[++i];
    else if (argv[i] === '--limit' && argv[i + 1]) args.limit = parseInt(argv[++i], 10);
    else if (argv[i] === '--cases' && argv[i + 1]) args.cases = argv[++i].split(',').map(s => s.trim());
    else if (argv[i] === '--allow-dirty') args.allowDirty = true;
  }
  // npm swallows flags unless invoked with an extra `--` separator, which
  // dispatch tools routinely drop. Env vars survive npm untouched.
  if (!args.cases && process.env.VOICE_EVAL_CASES) {
    args.cases = process.env.VOICE_EVAL_CASES.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!args.allowDirty && process.env.VOICE_EVAL_ALLOW_DIRTY === '1') args.allowDirty = true;
  if (!['smoke', 'full', 'stability'].includes(args.mode)) {
    console.error(`Unknown mode "${args.mode}". Use smoke, full, or stability.`);
    process.exit(1);
  }
  return args;
}

/**
 * The code that actually runs is what's on disk, not what git history says.
 * Report the checked-out commit and refuse to run if the scoring code or
 * the harness itself is locally modified (stale/reverted files have burned
 * real API money on runs that tested the wrong prompt).
 */
function gitPreflight(allowDirty) {
  let head = 'unknown';
  let branch = 'unknown';
  let dirty = [];
  try {
    const opts = { cwd: HERE, encoding: 'utf8' };
    head = execSync('git rev-parse --short HEAD', opts).trim();
    branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim();
    dirty = execSync('git status --porcelain', opts)
      .split('\n')
      .filter(line => line && !line.startsWith('??'))
      .map(line => line.slice(3));
  } catch (_) {
    // Not a git checkout (e.g. exported tarball) — nothing to verify.
  }

  const critical = dirty.filter(f =>
    f.includes('functions/_lib/voice-scorecard.js') ||
    f.includes('functions/_lib/openai-client.js') ||
    f.includes('tests/voice-transcripts/')
  );
  if (critical.length > 0 && !allowDirty) {
    console.error(
      '\nERROR: scoring/harness files on disk do not match the checked-out commit:\n' +
      critical.map(f => `  M ${f}`).join('\n') +
      '\n\nThe evaluation would test the modified files, not the committed code.\n' +
      'Restore them (git checkout -- <files>) or pass --allow-dirty / VOICE_EVAL_ALLOW_DIRTY=1\n' +
      'if the local modifications are intentional.\n'
    );
    process.exit(1);
  }

  return { head, branch, dirtyCritical: critical };
}

function requireApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      '\nERROR: OPENAI_API_KEY is not set.\n\n' +
      'These evaluations call the real OpenAI API and are local/opt-in only.\n' +
      'Set the key and re-run, e.g.:\n\n' +
      '  export OPENAI_API_KEY=sk-...\n' +
      '  npm run test:voice:transcripts:smoke\n'
    );
    process.exit(1);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isTransient(error) {
  return /rate limit|429|5\d{2}|timeout|network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket|missing content|Unexpected token|JSON/i
    .test(String(error?.message || error));
}

async function scoreWithRetry(fixture, env) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await scoreVoiceTranscript({
        role: fixture.role,
        seniority: fixture.seniority,
        transcript: toVoiceTranscript(fixture.transcript)
      }, env);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS && isTransient(error)) {
        const backoff = 2000 * 2 ** (attempt - 1);
        console.warn(`  [retry] ${fixture.id} attempt ${attempt} failed (${error.message}); retrying in ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

/**
 * Run tasks with limited concurrency, preserving order of results.
 */
async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

async function runCase(fixture, env, label) {
  try {
    const { scorecard, usage, model } = await scoreWithRetry(fixture, env);
    const evaluation = evaluateCase(fixture, scorecard);
    const status = evaluation.passed ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${label} (overall ${scorecard.overall}, outcome ${scorecard.saoBalance?.outcome}%)`);
    if (!evaluation.passed) {
      for (const f of evaluation.failures) console.log(`         - ${f.category}: ${f.message}`);
    }
    return { fixture, scorecard, usage, model, evaluation };
  } catch (error) {
    console.error(`  [ERROR] ${label}: ${error.message}`);
    return { fixture, error: error.message };
  }
}

function buildMarkdownReport(report) {
  const s = report.summary;
  const lines = [
    `# Voice Transcript Evaluation Report — ${report.mode}`,
    '',
    `- **Date:** ${report.timestamp}`,
    `- **Commit:** ${report.commit} (${report.branch})`,
    `- **Model:** ${report.model || 'unknown'}`,
    `- **Total cases:** ${s.totalCases}`,
    `- **Passed:** ${s.passed}`,
    `- **Failed:** ${s.failed}${s.apiErrors ? ` (${s.apiErrors} API errors)` : ''}`,
    `- **Pass rate:** ${s.passRate}%`,
    `- **Token usage:** ${s.tokenUsage ? `${s.tokenUsage.totalTokens} total (${s.tokenUsage.promptTokens} prompt / ${s.tokenUsage.completionTokens} completion)` : 'unavailable'}`,
    `- **Estimated API cost:** ${s.estimatedCostUsd != null ? `$${s.estimatedCostUsd}` : 'unavailable'}`,
    '',
    '## Failures by category',
    ''
  ];
  const cats = Object.entries(s.failuresByCategory);
  if (cats.length === 0) {
    lines.push('None.');
  } else {
    lines.push('| Category | Count |', '| --- | --- |');
    for (const [cat, count] of cats.sort((a, b) => b[1] - a[1])) lines.push(`| ${cat} | ${count} |`);
  }

  lines.push('', '## Average scores by expected quality level', '',
    '| Quality | Cases | Avg overall | Avg structure (0-100) | Avg outcome % |',
    '| --- | --- | --- | --- | --- |');
  for (const q of ['excellent', 'good', 'average', 'weak', 'poor']) {
    const row = s.averagesByQuality[q];
    if (row) lines.push(`| ${q} | ${row.cases} | ${row.avgOverall} | ${row.avgStructure} | ${row.avgOutcomePct} |`);
  }

  if (report.stability) {
    lines.push('', '## Stability (score variance across repeated runs)', '',
      `Average overall-score spread: **${report.stability.avgOverallSpread}** points (max ${report.stability.maxOverallSpread}).`, '',
      '| Case | Runs | Overall mean | Overall stddev | Overall spread | Outcome% stddev |',
      '| --- | --- | --- | --- | --- | --- |');
    for (const c of report.stability.cases) {
      lines.push(`| ${c.id} | ${c.stats.runs} | ${c.stats.overall.mean} | ${c.stats.overall.stddev} | ${c.stats.overall.spread} | ${c.stats.outcomePct.stddev} |`);
    }
  }

  const failedCases = report.cases.filter(c => c.error || (c.evaluation && !c.evaluation.passed));
  lines.push('', '## Failed cases', '');
  if (failedCases.length === 0) {
    lines.push('None.');
  } else {
    for (const c of failedCases) {
      lines.push(`### ${c.id} (${c.archetype} / ${c.qualityLevel})`, '');
      if (c.error) {
        lines.push(`- API error: ${c.error}`);
      } else {
        for (const f of c.evaluation.failures) lines.push(`- ${f.category}: ${f.message}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireApiKey();

  const env = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ...(process.env.OPENAI_MODEL_VOICE_SCORE
      ? { OPENAI_MODEL_VOICE_SCORE: process.env.OPENAI_MODEL_VOICE_SCORE }
      : {})
  };

  const fixtures = loadFixtures(FIXTURES_PATH);
  let cases;
  if (args.mode === 'smoke') cases = selectSmokeCases(fixtures);
  else if (args.mode === 'stability') cases = selectStabilityCases(fixtures);
  else cases = fixtures;
  if (args.cases) {
    cases = fixtures.filter(f => args.cases.includes(f.id));
    const missing = args.cases.filter(id => !cases.some(f => f.id === id));
    if (missing.length > 0) {
      console.error(`Unknown fixture IDs: ${missing.join(', ')}`);
      process.exit(1);
    }
  }
  if (args.limit) cases = cases.slice(0, args.limit);

  const git = gitPreflight(args.allowDirty);
  const runsPerCase = args.mode === 'stability' ? STABILITY_RUNS : 1;
  console.log(`\nVoice transcript evaluation — mode: ${args.mode}`);
  console.log(`Commit: ${git.head} (${git.branch})${git.dirtyCritical.length ? ' — DIRTY, --allow-dirty in effect' : ''}`);
  if (args.cases) console.log(`Case filter: ${cases.length} targeted case(s)`);
  console.log(`Cases: ${cases.length}${runsPerCase > 1 ? ` x ${runsPerCase} runs` : ''}, concurrency: ${CONCURRENCY}\n`);

  const tasks = [];
  for (const fixture of cases) {
    for (let run = 1; run <= runsPerCase; run++) {
      const label = runsPerCase > 1 ? `${fixture.id} (run ${run}/${runsPerCase})` : fixture.id;
      tasks.push(() => runCase(fixture, env, label));
    }
  }

  const started = Date.now();
  const results = await runPool(tasks, CONCURRENCY);
  const durationS = round2((Date.now() - started) / 1000);

  const summary = aggregateResults(results);

  let stability = null;
  if (args.mode === 'stability') {
    const byId = new Map();
    for (const r of results.filter(r => !r.error)) {
      if (!byId.has(r.fixture.id)) byId.set(r.fixture.id, []);
      byId.get(r.fixture.id).push(r);
    }
    const caseStats = [...byId.entries()].map(([id, runs]) => ({ id, stats: stabilityStats(runs) }));
    stability = {
      cases: caseStats,
      avgOverallSpread: round2(mean(caseStats.map(c => c.stats.overall.spread))),
      maxOverallSpread: round2(Math.max(0, ...caseStats.map(c => c.stats.overall.spread)))
    };
  }

  const report = {
    mode: args.mode,
    timestamp: new Date().toISOString(),
    commit: git.head,
    branch: git.branch,
    durationSeconds: durationS,
    model: results.find(r => r.model)?.model || null,
    summary,
    stability,
    cases: results.map(r => ({
      id: r.fixture.id,
      archetype: r.fixture.archetype,
      qualityLevel: r.fixture.qualityLevel,
      role: r.fixture.role,
      ...(r.error
        ? { error: r.error }
        : {
            evaluation: r.evaluation,
            scores: {
              overall: r.scorecard.overall,
              dimensions: r.scorecard.dimensions,
              saoBalance: r.scorecard.saoBalance
            },
            // Full feedback text kept for failed cases (and every case in a
            // targeted --cases run) so concept-check failures and suspected
            // contradictions can be diagnosed from the report alone.
            ...((r.evaluation.passed && !args.cases) ? {} : {
              feedback: {
                saoCoaching: r.scorecard.saoCoaching,
                topStrength: r.scorecard.topStrength,
                topImprovement: r.scorecard.topImprovement,
                moments: r.scorecard.moments,
                summary: r.scorecard.summary
              }
            }),
            usage: r.usage
          })
    }))
  };

  mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = report.timestamp.replace(/[:.]/g, '-');
  const jsonPath = join(REPORTS_DIR, `voice-transcripts-${args.mode}-${stamp}.json`);
  const mdPath = join(REPORTS_DIR, `voice-transcripts-${args.mode}-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, buildMarkdownReport(report));

  console.log(`\nDone in ${durationS}s — ${summary.passed}/${summary.totalCases} passed (${summary.passRate}%).`);
  if (summary.tokenUsage) {
    console.log(`Tokens: ${summary.tokenUsage.totalTokens}${summary.estimatedCostUsd != null ? `, estimated cost: $${summary.estimatedCostUsd}` : ''}`);
  }
  if (stability) {
    console.log(`Stability: avg overall-score spread ${stability.avgOverallSpread} pts, max ${stability.maxOverallSpread} pts.`);
  }
  console.log(`Reports:\n  ${jsonPath}\n  ${mdPath}`);

  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Evaluation harness crashed:', error);
  process.exit(1);
});
