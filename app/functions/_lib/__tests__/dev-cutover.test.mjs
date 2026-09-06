import assert from 'node:assert/strict';
import { onRequest } from '../../_middleware.js';
import { isDevCutoverPaused } from '../dev-cutover.js';
import retention from '../../../../workers/retention-cleaner/src/index.js';
import inactive from '../../../../workers/inactive-account-cleaner/src/index.js';

for (const environment of ['dev', 'development', ' DEV ']) {
  const env = { ENVIRONMENT: environment, DEV_CUTOVER_PAUSED: 'true' };
  for (const origin of ['https://dev.jobhackai.io', 'https://jobhackai-app-dev.pages.dev']) {
    for (const [path, method] of [['/api/stripe-webhook', 'POST'], ['/api/plan/me', 'GET'], ['/api/user/delete', 'DELETE'], ['/dashboard', 'GET']]) {
      let downstream = 0;
      const response = await onRequest({ env, request: new Request(origin + path, { method }), next: async () => { downstream++; return new Response('unexpected'); } });
      assert.equal(response.status, 503);
      assert.equal(downstream, 0, `${environment} ${method} ${path} must not reach a handler`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('retry-after'), '120');
    }
  }
  for (const worker of [retention, inactive]) {
    let reads = 0, scheduled = 0;
    await worker.scheduled({}, { ...env, get JOBHACKAI_DB() { reads++; return null; } }, { waitUntil() { scheduled++; } });
    assert.equal(reads, 0);
    assert.equal(scheduled, 0);
  }
}

for (const environment of ['qa', 'prod', 'production', '', undefined, 'deev']) {
  const env = { ENVIRONMENT: environment, DEV_CUTOVER_PAUSED: 'true' };
  assert.equal(isDevCutoverPaused(env), false, `maintenance must not affect ${environment}`);
  let reached = 0;
  const response = await onRequest({ env, request: new Request('https://app.jobhackai.io/dashboard'), next: async () => { reached++; return new Response('ok'); } });
  assert.equal(reached, 1);
  assert.equal(response.status, 200);
}
for (const value of [undefined, '', 'false', '0']) {
  assert.equal(isDevCutoverPaused({ ENVIRONMENT: 'dev', DEV_CUTOVER_PAUSED: value }), false);
}
console.log('dev cutover: requests stop before handlers, scheduled jobs stop before storage, and QA/production remain unaffected');
