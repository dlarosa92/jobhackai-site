import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { callOpenAI, generateATSFeedback, generateResumeRewrite, generateRoleTips } from '../openai-client.js';
import { textCompletionParameters, estimateTextCost } from '../openai-text-models.js';
import { verifyGrammarWithAI } from '../grammar-ai-check.js';
import { generateRoleTemplate } from '../openai-template-generator.js';
import { scoreVoiceTranscript, SCORECARD_SCHEMA } from '../voice-scorecard.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const env = { OPENAI_API_KEY: 'test-fixture-not-a-real-key' };
const schema = { name: 'example', strict: true, schema: {
  type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false
} };
function reply(content = '{"ok":true}', model = 'gpt-6-luna', finish_reason = 'stop') {
  return Response.json({ model, choices: [{ message: { content }, finish_reason }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 30 } } });
}
function mockFetch(t, handler = () => reply()) {
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    return handler(body, calls.length, init);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}
function assertModern(body, model, cap, temperature) {
  assert.equal(body.model, model);
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(body.max_completion_tokens, cap);
  assert.equal(body.temperature, temperature);
  assert.ok(!Object.hasOwn(body, 'max_tokens'));
}
function kv() {
  const map = new Map();
  return { map, get: async key => map.get(key) ?? null, put: async (key, value) => map.set(key, value) };
}

test('shared default sends the original strict JSON contract with an explicit output budget', async t => {
  const calls = mockFetch(t);
  const messages = [{ role: 'user', content: 'Return JSON.' }];
  const result = await callOpenAI({ messages, responseFormat: schema, maxTokens: 321, temperature: 0.1 }, env);
  assertModern(calls[0], 'gpt-6-luna', 321, 0.1);
  assert.deepEqual(calls[0].messages, messages);
  assert.deepEqual(calls[0].response_format, { type: 'json_schema', json_schema: schema });
  assert.equal(result.usage.cachedTokens, 30);
});

test('explicit legacy overrides preserve their original request parameters during staged rollout', async t => {
  const calls = mockFetch(t);
  await callOpenAI({ model: 'gpt-4.1', maxTokens: 20, temperature: 0 }, env);
  assert.equal(calls[0].model, 'gpt-4.1');
  assert.equal(calls[0].max_tokens, 20);
  assert.ok(!Object.hasOwn(calls[0], 'reasoning_effort'));
  assert.deepEqual(textCompletionParameters('gpt-6-sol', 500, 0.2), {
    max_completion_tokens: 500, reasoning_effort: 'none', temperature: 0.2
  });
});

test('API failures rebuild the request for the fallback without changing JSON schema', async t => {
  const calls = mockFetch(t, (body, n) => n === 1
    ? Response.json({ error: { message: 'unavailable' } }, { status: 503 }) : reply('{"ok":true}', body.model));
  const result = await callOpenAI({ model: 'gpt-4.1', fallbackModel: 'gpt-6-sol',
    maxRetries: 2, maxTokens: 500, responseFormat: schema }, env);
  assert.deepEqual(calls.map(c => c.model), ['gpt-4.1', 'gpt-6-sol']);
  assertModern(calls[1], 'gpt-6-sol', 500, 0.2);
  assert.deepEqual(calls[1].response_format, calls[0].response_format);
  assert.equal(result.model, 'gpt-6-sol');
});

test('network failures use fallback and retry within the existing attempt limit', async t => {
  const calls = mockFetch(t, (body, n) => {
    if (n < 3) throw new TypeError('fetch failed');
    return reply('{"ok":true}', body.model);
  });
  await callOpenAI({ model: 'gpt-6-sol', fallbackModel: 'gpt-6-luna', maxRetries: 3 }, env);
  assert.deepEqual(calls.map(c => c.model), ['gpt-6-sol', 'gpt-6-luna', 'gpt-6-luna']);
});

test('429 stays on the primary model and never triggers a paid fallback', async t => {
  const calls = mockFetch(t, () => Response.json({ error: { message: 'rate limited' } },
    { status: 429, headers: { 'Retry-After': '0' } }));
  await assert.rejects(callOpenAI({ fallbackModel: 'gpt-6-sol', maxRetries: 2, maxBackoffMs: 0 }, env), /429/);
  assert.deepEqual(calls.map(c => c.model), ['gpt-6-luna', 'gpt-6-luna']);
});

test('a timed out request uses the existing fallback policy', async t => {
  const calls = mockFetch(t, (body, n, init) => n === 1 ? new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }) : reply('{"ok":true}', body.model));
  await callOpenAI({ fallbackModel: 'gpt-6-sol', maxRetries: 2, timeoutMs: 5 }, env);
  assert.deepEqual(calls.map(c => c.model), ['gpt-6-luna', 'gpt-6-sol']);
});

test('application cache separates models and never reuses truncated JSON', async t => {
  const calls = mockFetch(t, (body, n) => reply('{"ok":true}', body.model, n === 3 ? 'length' : 'stop'));
  const cache = kv(), cachedEnv = { ...env, JOBHACKAI_KV: cache };
  const options = { systemPrompt: 'Return JSON.', maxRetries: 1 };
  await callOpenAI({ ...options, model: 'gpt-4.1-mini' }, cachedEnv);
  await callOpenAI(options, cachedEnv);
  assert.equal((await callOpenAI(options, cachedEnv)).fromCache, true);
  await callOpenAI({ ...options, model: 'gpt-6-sol' }, cachedEnv);
  await callOpenAI({ ...options, model: 'gpt-6-sol' }, cachedEnv);
  assert.equal(calls.length, 4);
});

const answer = 'I compared customer interviews with support tickets and found setup failures were preventing adoption. I prioritized an onboarding fix, tested it with five customers, and measured whether they completed setup without support. I shared the results with the product team.';
const transcript = [{ speaker: 'assistant', text: 'Tell me about a project.' }, { speaker: 'user', text: answer }];
const card = { assessmentScope: 'Product Manager practice sample', overall: 70,
  moments: [{ quote: 'I prioritized an onboarding fix', comment: 'Specific action.' }, { quote: 'Tell me about a project.', comment: 'Invalid interviewer quote.' }],
  competencies: [{ name: 'Prioritization', status: 'demonstrated', quote: 'I prioritized an onboarding fix', feedback: 'You chose a concrete action.' },
    { name: 'Leadership', status: 'needs_practice', quote: 'invented evidence', feedback: 'Unsupported.' }] };

// Distinct synthetic answer blocks exercise the request contract for a sample
// above the word/answer threshold; they do not test model assessment quality.
const substantialTranscript = ['first', 'second', 'third'].flatMap(prefix => [
  { speaker: 'assistant', text: `Describe your ${prefix} example.` },
  { speaker: 'user', text: `${answer} ${Array.from({ length: 100 }, (_, i) => `${prefix}${i}`).join(' ')}` }
]);
const groundedCard = { ...card, competencies: [...card.competencies,
  { name: 'Testing', status: 'demonstrated', quote: 'tested it with five customers', feedback: 'You tested the change.' },
  { name: 'Communication', status: 'demonstrated', quote: 'I shared the results with the product team.', feedback: 'You shared the results.' }
] };
for (const limited of [true, false]) {
  test(`voice ${limited ? 'limited feedback' : 'scoring'} retains strict schema, token cap, grounding and distinct fallback`, async t => {
    const calls = mockFetch(t, (body, n) => n === 1 ? Response.json({}, { status: 500 }) : reply(JSON.stringify(groundedCard), body.model));
    const expectedSchema = structuredClone(SCORECARD_SCHEMA);
    if (limited) {
      expectedSchema.name = 'voice_interview_feedback';
      for (const key of ['overall', 'dimensions', 'saoBalance']) {
        expectedSchema.schema.properties[key] = { type: 'null', description: 'No numerical assessment for this limited sample.' };
      }
    }
    const result = await scoreVoiceTranscript({ role: 'Product Manager', transcript: limited ? transcript : substantialTranscript }, env);
    assert.deepEqual(calls.map(c => c.model), ['gpt-6-luna', 'gpt-6-sol']);
    for (const body of calls) {
      assertModern(body, body.model, 2400, 0.1);
      assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: expectedSchema });
    }
    assert.equal(result.scorecard.moments.length, 1);
    assert.equal(result.scorecard.competencies[1].status, 'not_assessed');
    assert.equal(result.scorecard.methodologyVersion, 2);
    // This fixture includes an invented assessment and an interviewer quote.
    // A long transcript cannot make their dependent global score trustworthy.
    assert.equal(result.scorecard.evidenceLimited, true);
    assert.equal(result.scorecard.scoreEligibility.eligible, false);
    assert.equal(result.scorecard.overall, null);
    assert.equal(result.scorecard.feedbackOnly, true);
  });
}

test('voice scoring honors the configured quality tier', async t => {
  const calls = mockFetch(t, body => reply(JSON.stringify(card), body.model));
  await scoreVoiceTranscript({ role: 'Product Manager', transcript }, { ...env, OPENAI_MODEL_VOICE_SCORE: 'gpt-6-sol' });
  assertModern(calls[0], 'gpt-6-sol', 2400, 0.1);
});

for (const [name, content, finish] of [['malformed JSON', '{', 'stop'], ['refusal or empty output', '', 'stop'], ['truncation', JSON.stringify(card), 'length']]) {
  test(`voice scoring rejects ${name} instead of storing a scorecard`, async t => {
    mockFetch(t, () => reply(content, 'gpt-6-luna', finish));
    await assert.rejects(scoreVoiceTranscript({ role: 'Product Manager', transcript }, env));
  });
}

test('grammar keeps its 20 token structured response and cache follows the override', async t => {
  const calls = mockFetch(t, () => reply('{"errors":true}'));
  const cache = kv(), grammarEnv = { ...env, JOBHACKAI_KV: cache };
  assert.equal(await verifyGrammarWithAI('He have experience.', grammarEnv), true);
  await verifyGrammarWithAI('He have experience.', grammarEnv);
  await verifyGrammarWithAI('He have experience.', { ...grammarEnv, OPENAI_MODEL_GRAMMAR: 'gpt-6-sol' });
  assert.equal(calls.length, 2);
  assertModern(calls[0], 'gpt-6-luna', 20, 0);
  assertModern(calls[1], 'gpt-6-sol', 20, 0);
  assert.equal(calls[0].response_format.json_schema.schema.properties.errors.type, 'boolean');
});

test('grammar preserves graceful failure and does not cache API errors', async t => {
  mockFetch(t, () => Response.json({}, { status: 500 }));
  const cache = kv();
  assert.equal(await verifyGrammarWithAI('Example', { ...env, JOBHACKAI_KV: cache }), false);
  assert.equal(cache.map.size, 0);
});

test('role templates retain JSON object mode with bounded generation', async t => {
  const calls = mockFetch(t, () => reply('{"must_have":["sql"],"nice_to_have":[],"tools":[]}'));
  const result = await generateRoleTemplate(env, 'Data Engineer');
  assert.deepEqual(result.must_have, ['sql']);
  assertModern(calls[0], 'gpt-6-luna', 1200, 0.3);
  assert.deepEqual(calls[0].response_format, { type: 'json_object' });
});

test('resume feedback and role tips honor overrides and rewrite keeps its cheaper fallback', async t => {
  const calls = mockFetch(t, (body, n) => n === 3 ? Response.json({}, { status: 503 }) : reply('{"roleSpecificFeedback":{}}', body.model));
  await generateATSFeedback('Experience', {}, null, env, { skipRoleTips: true });
  await generateRoleTips('Experience', {}, 'Engineer', { ...env, OPENAI_MODEL_FEEDBACK: 'gpt-6-sol' });
  await generateResumeRewrite('Experience', null, 'Engineer', null, null, env);
  assert.deepEqual(calls.map(c => c.model), ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-sol', 'gpt-6-luna']);
  assert.equal(calls[0].max_completion_tokens, 800);
  assert.deepEqual(calls[2].response_format, calls[3].response_format);
});

test('question and mock scoring builders preserve their contracts and shared override', async t => {
  const calls = mockFetch(t, body => reply('{"questions":[],"overall_score":70}', body.model));
  const builders = [
    ['interview-questions/generate.js', 'generateQuestions', 'gpt-6-luna', 2000, 'OPENAI_MODEL_IQ'],
    ['mock-interview/generate-questions.js', 'generateMockInterviewQuestions', 'gpt-6-luna', 1500, 'OPENAI_MODEL_MI'],
    ['mock-interview/score.js', 'scoreMockInterview', 'gpt-6-sol', 3000, 'OPENAI_MODEL_MI']
  ];
  for (const [file, fn, model, cap, override] of builders) {
    const source = readFileSync(new URL('../../api/' + file, import.meta.url), 'utf8');
    const context = vm.createContext({ callOpenAI, console, crypto: globalThis.crypto });
    vm.runInContext(source.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '') + `\nglobalThis.build = ${fn};`, context);
    const input = { role: 'Engineer', seniority: 'Mid', type: 'mixed', count: 3, interviewStyle: 'mixed', qaPairs: [{ q: 'Project?', a: answer }] };
    await context.build(input, env);
    const first = calls.at(-1);
    assert.equal(first.model, model);
    assert.equal(first.max_completion_tokens, cap);
    assert.equal(first.response_format.type, 'json_schema');
    await context.build(input, { ...env, [override]: 'gpt-6-sol' });
    assert.equal(calls.at(-1).model, 'gpt-6-sol');
    assert.deepEqual(calls.at(-1).response_format, first.response_format);
  }
});

test('cost estimates distinguish cached input, model snapshots and unavailable usage', () => {
  assert.equal(estimateTextCost('gpt-6-luna', 1e6, 1e6), 0.6);
  assert.equal(estimateTextCost('gpt-6-sol', 1e6, 1e6), 12);
  assert.equal(estimateTextCost('gpt-6-luna', 1e6, 1e6, 5e5), 0.555);
  assert.equal(estimateTextCost('gpt-4.1-mini-2025-04-14', 1e6, 1e6), 2);
  assert.equal(estimateTextCost('gpt-6-sol', null, 20), null);
  assert.equal(estimateTextCost('unknown-model', 100, 20), null);
  assert.equal(estimateTextCost('gpt-4o-audio', 100, 20), null);
});

test('all executable defaults and diagnostic calls exclude the retiring text models', () => {
  const root = new URL('../../../../', import.meta.url);
  function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      if (['__tests__', 'tests', 'node_modules'].includes(entry.name)) return [];
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      return entry.isDirectory() ? walk(path) : /\.(js|mjs|ts)$/.test(entry.name) ? [path] : [];
    });
  }
  const paths = ['app/functions/', 'functions/', 'workers/'].flatMap(p => walk(new URL(p, root)));
  paths.push(new URL('test-openai-direct.js', root));
  const retired = /['"]gpt-(?:4o(?:-mini)?|4\.1(?:-mini)?)(?:-\d{4}-\d{2}-\d{2})?['"]/;
  for (const path of paths) {
    if (path.pathname.endsWith('/openai-text-models.js')) continue; // Historical pricing only.
    assert.ok(!retired.test(readFileSync(path, 'utf8')), path.pathname);
  }
});
