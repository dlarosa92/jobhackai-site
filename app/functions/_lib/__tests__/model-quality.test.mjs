import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCoverLetterText, countWords } from '../cover-letter-generator.js';
import { preserveRecommendationText } from '../linkedin-grounding.js';
import { createTextQaHandler } from '../../api/qa/text.js';
import { profiles, cases } from '../../../tests/model-quality/cases.mjs';
const words = n => Array(n).fill('word').join(' ');
for (const p of profiles) {
  test(`cover letter ${p.id}: short draft is revised using original evidence`, async () => {
    let calls = 0;
    const result = await generateCoverLetterText(p, {}, 'test', async options => {
      calls++;
      assert.match(options.messages[1].content, new RegExp(p.role));
      assert.ok(options.messages[1].content.includes(p.resumeText));
      if (calls === 2) assert.match(options.messages.at(-1).content, /original input/);
      return { content: words(calls === 1 ? 180 : 280), finishReason: 'stop' };
    });
    assert.equal(calls, 2); assert.equal(countWords(result.content), 280);
  });
  test(`endorsement ${p.id}: invented quote and attribution are replaced by the exact source`, () => {
    const out = { score: 70, feedbackBullets: ['Ask for specific examples.'], optimizedText: '"Excellent team leader." — CEO' };
    preserveRecommendationText(out, p.recommendations);
    assert.equal(out.optimizedText, p.recommendations);
    assert.equal(out.score, 70); assert.deepEqual(out.feedbackBullets, ['Ask for specific examples.']);
  });
}
test('cover letters reject repeated underlength, overlength, empty and truncated drafts after two attempts', async () => {
  for (const [content, finishReason] of [[words(120), 'stop'], [words(351), 'stop'], ['', 'stop'], [words(280), 'length']]) {
    let calls = 0;
    await assert.rejects(generateCoverLetterText(profiles[0], {}, 'test', async () => { calls++; return { content, finishReason }; }), /length_validation/);
    assert.equal(calls, 2);
  }
});
test('valid boundary lengths need only one request', async () => {
  for (const count of [250, 350]) {
    let calls = 0;
    const result = await generateCoverLetterText(profiles[0], {}, 'test', async () => { calls++; return { content: words(count) }; });
    assert.equal(calls, 1); assert.equal(result.wordCount, count);
  }
});
const env = { ENVIRONMENT: 'dev', VOICE_QA_EVAL_UID: 'operator', VOICE_QA_EVAL_UNTIL: '2099-01-01', OPENAI_API_KEY: 'fixture' };
const request = (method = 'GET', id = cases[0].id, authenticated = true) => new Request('https://dev.jobhackai.io/api/qa/text?case=' + id, {
  method, headers: authenticated ? { authorization: 'Bearer fixture' } : {},
  ...(method === 'POST' ? { body: JSON.stringify({ model: 'untrusted', prompt: 'private data' }) } : {})
});
test('text evaluator denies production, missing environment, unknown environment, missing operator and expiry', async () => {
  const handler = createTextQaHandler({ verify: () => { throw Error('not reached'); }, evaluate: () => { throw Error('not reached'); } });
  for (const change of [{ ENVIRONMENT: 'prod' }, { ENVIRONMENT: 'production' }, { ENVIRONMENT: '' }, { ENVIRONMENT: 'preview' }, { VOICE_QA_EVAL_UID: '' }, { VOICE_QA_EVAL_UNTIL: '' }, { VOICE_QA_EVAL_UNTIL: '2000-01-01' }]) {
    const response = await handler({ request: request('POST'), env: { ...env, ...change } });
    assert.equal(response.status, 404); assert.match(response.headers.get('cache-control'), /no-store/);
  }
});
test('text evaluator rejects unauthenticated, wrong operator and unsupported method before generation', async () => {
  let calls = 0;
  for (const [req, verify, status] of [
    [request('POST', cases[0].id, false), async () => ({ uid: 'operator' }), 401],
    [request('POST'), async () => { throw Error(); }, 401],
    [request('POST'), async () => ({ uid: 'other' }), 404],
    [request('DELETE'), async () => ({ uid: 'operator' }), 405]
  ]) assert.equal((await createTextQaHandler({ verify, evaluate: () => { calls++; } })({ request: req, env })).status, status);
  assert.equal(calls, 0);
});
test('exactly five server-owned profiles per feature; arbitrary body and unknown fixture cannot change generation', async () => {
  let calls = 0;
  const handler = createTextQaHandler({ verify: async () => ({ uid: 'operator' }), evaluate: async fixture => { calls++; assert.equal(fixture, cases[0]); return { issues: [] }; } });
  const list = await (await handler({ request: request(), env })).json();
  assert.equal(list.cases.length, 55);
  for (const f of new Set(list.cases.map(c => c.feature))) assert.equal(list.cases.filter(c => c.feature === f).length, 5);
  assert.equal((await handler({ request: request('POST', 'custom'), env })).status, 400);
  assert.equal((await handler({ request: request('POST'), env })).status, 200);
  assert.equal(calls, 1);
});
test('provider failures are sanitized and missing provider key does not invoke generation', async () => {
  const handler = createTextQaHandler({ verify: async () => ({ uid: 'operator' }), evaluate: async () => { throw Error('secret'); } });
  const response = await handler({ request: request('POST'), env });
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('secret'));
  assert.equal((await handler({ request: request('POST'), env: { ...env, OPENAI_API_KEY: '' } })).status, 503);
});
