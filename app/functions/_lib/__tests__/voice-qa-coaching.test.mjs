import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
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

const coachingPage = readFileSync(new URL('../../../../voice-coaching-check.html', import.meta.url), 'utf8');
const coachingScript = coachingPage.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/import authManager from [^;]+;/, '');
async function coachingClient(initialUser, { hostname = 'qa.jobhackai.io', response } = {}) {
  const nodes = new Map(), calls = [], events = {};
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { disabled: true, textContent: '', addEventListener(type, fn) { this[type] = fn; } });
    return nodes.get(id);
  };
  await vm.runInNewContext('(async()=>{' + coachingScript + '})()', {
    document: { getElementById: element }, location: { hostname }, Date, AbortSignal,
    authManager: { waitForAuthReady: async () => initialUser, onAuthStateChange(fn) { events.auth = fn; } },
    async fetch(path, options) {
      calls.push({ path, method: options.method });
      return response ? await response : { ok: true, json: async () => ({ cases: [{ id: 'fixed-case' }] }) };
    }
  });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  return { element, calls, events, flush };
}
const readyOperator = { getIdToken: async () => 'test-only-token' };
test('coaching page recovers from pending auth without refresh or automatically scoring', async () => {
  const h = await coachingClient({ _authPending: true });
  assert.equal(h.element('run').disabled, true);
  assert.match(h.element('status').textContent, /still loading/);
  assert.equal(h.calls.length, 0);
  h.events.auth(readyOperator); await h.flush();
  assert.equal(h.element('run').disabled, false);
  assert.deepEqual(h.calls, [{ path: '/api/voice/qa-coaching', method: 'GET' }]);
});
test('late coaching access response cannot enable a signed-out account', async () => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const h = await coachingClient({ _authPending: true }, { response });
  h.events.auth(readyOperator); await h.flush();
  h.events.auth(null);
  finish({ ok: true, json: async () => ({ cases: [{ id: 'fixed-case' }] }) });
  await h.flush();
  assert.equal(h.element('run').disabled, true);
  assert.equal(h.element('status').textContent, 'Sign in on this QA tab first.');
});
test('production coaching page never subscribes to auth or requests evaluation access', async () => {
  const h = await coachingClient(readyOperator, { hostname: 'app.jobhackai.io' });
  assert.equal(h.events.auth, undefined);
  assert.equal(h.calls.length, 0);
  assert.equal(h.element('run').disabled, true);
});
