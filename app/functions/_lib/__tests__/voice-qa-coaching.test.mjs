import test from 'node:test';
import assert from 'node:assert/strict';
import { createQaCoachingHandler } from '../../api/voice/qa-coaching.js';
import { cases } from '../../../tests/voice-coaching/cases.mjs';

const env = { ENVIRONMENT: 'qa', VOICE_QA_EVAL_UID: 'operator', VOICE_QA_EVAL_UNTIL: '2099-01-01', OPENAI_API_KEY: 'fixture' };
const request = (method = 'GET', authenticated = true, id = cases[0].id, body) => new Request('https://qa.jobhackai.io/api/voice/qa-coaching?case=' + id, {
  method, headers: authenticated ? { authorization: 'Bearer fixture' } : {}, ...(body ? { body } : {})
});

test('production, unknown environments, missing operator and expired windows cannot authenticate or score', async () => {
  const handler = createQaCoachingHandler({ verify: () => { throw Error('must not authenticate'); }, score: () => { throw Error('must not score'); } });
  for (const change of [{ ENVIRONMENT: 'prod' }, { ENVIRONMENT: 'production' }, { ENVIRONMENT: '' }, { ENVIRONMENT: 'prd' }, { VOICE_QA_EVAL_UID: '' }, { VOICE_QA_EVAL_UNTIL: '' }, { VOICE_QA_EVAL_UNTIL: '2000-01-01' }]) {
    const response = await handler({ request: request('POST'), env: { ...env, ...change } });
    assert.equal(response.status, 404);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});

test('authentication, operator and method gates precede scoring', async () => {
  let calls = 0;
  const score = () => { calls++; throw Error(); };
  for (const [req, verify, status] of [
    [request('POST', false), async () => ({ uid: 'operator' }), 401],
    [request('POST'), async () => { throw Error('bad token'); }, 401],
    [request('POST'), async () => ({ uid: 'another-user' }), 404],
    [request('DELETE'), async () => ({ uid: 'operator' }), 405]
  ]) assert.equal((await createQaCoachingHandler({ verify, score })({ request: req, env })).status, status);
  assert.equal(calls, 0);
});

test('only fixed synthetic cases reach the scorer; request bodies cannot supply transcripts or models', async () => {
  let calls = 0;
  const handler = createQaCoachingHandler({ verify: async () => ({ uid: 'operator' }), score: async fixture => {
    assert.equal(fixture, cases[0]); calls++;
    return { model: 'test-model', usage: { total_tokens: 100 }, fromCache: false, scorecard: {
      methodologyVersion: 2, assessmentScope: 'Synthetic sample', competencies: [{}, {}, {}], moments: []
    } };
  } });
  const list = await handler({ request: request(), env });
  const listedCases = (await list.json()).cases;
  assert.equal(listedCases.length, 8);
  assert.ok(listedCases.some(item => item.id === 'metrics-requested'));
  assert.equal(calls, 0);
  assert.equal((await handler({ request: request('POST', true, 'arbitrary-case'), env })).status, 400);
  const result = await handler({ request: request('POST', true, cases[0].id, JSON.stringify({ transcript: 'private candidate text', model: 'other-model' })), env });
  const data = await result.json();
  assert.equal(result.status, 200);
  assert.deepEqual(data.issues, []);
  assert.equal(data.id, cases[0].id);
  assert.equal(calls, 1);
});

test('scorer failures do not expose provider or secret data', async () => {
  const handler = createQaCoachingHandler({ verify: async () => ({ uid: 'operator' }), score: async () => { throw Error('secret provider detail'); } });
  const response = await handler({ request: request('POST'), env });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'synthetic_scoring_failed' });
});
