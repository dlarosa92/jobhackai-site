// Run: node --conditions=workerd --test app/functions/_lib/__tests__/kv-test.test.mjs
// Select jose's Workers export so JWKS requests use the intercepted fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as endpoint } from '../../api/kv-test.js';
import { onRequest as middleware } from '../../_middleware.js';

// Use real JWT verification with a local signing key and intercepted JWKS.
// No Firebase, Cloudflare or customer data is accessed.
const pair = await crypto.subtle.generateKey({
  name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'
}, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'kv-test-fixture', alg: 'RS256', use: 'sig' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({
  sub: 'user-a', aud: 'fixture', iss: 'https://securetoken.google.com/fixture', iat: now, exp: now + 600
});
const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned));
const token = unsigned + '.' + Buffer.from(signature).toString('base64url');

test('KV diagnostics enforce environment, authentication and key boundaries', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let jwksRequests = 0;
  globalThis.fetch = async input => {
    assert.equal(String(input instanceof Request ? input.url : input),
      'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    jwksRequests++;
    return Response.json({ keys: [jwk] });
  };
  const calls = [];
  t.beforeEach(() => { calls.length = 0; });
  const kv = {
    get: async key => { calls.push(['get', key]); return JSON.stringify({ enabled: true }); },
    put: async (...args) => { calls.push(['put', ...args]); }
  };
  const run = ({ environment = 'qa', path = '/api/kv-test', method = 'GET', bearer = token } = {}) => endpoint({
    request: new Request('https://app.jobhackai.io' + path, {
      method, headers: bearer ? { Authorization: 'Bearer ' + bearer } : {}
    }),
    env: { ENVIRONMENT: environment, FIREBASE_PROJECT_ID: 'fixture', JOBHACKAI_KV: kv }
  });

  await t.test('production, missing and unknown environments are blocked before auth or KV access', async () => {
    for (const environment of ['prod', 'production', '', 'prd']) {
      for (const method of ['GET', 'OPTIONS', 'POST']) {
        const response = await run({ environment, method });
        assert.equal(response.status, 404, `${environment || 'missing'} ${method}`);
        assert.match(response.headers.get('cache-control'), /no-store/);
      }
    }
    assert.equal(jwksRequests, 0);
    assert.deepEqual(calls, []);
  });

  await t.test('the outer middleware independently blocks the production route', async () => {
    for (const path of ['/api/kv-test', '/api/kv-test/', '/api/kv-test?key=resume:user-b:123']) {
      let reachedHandler = false;
      const response = await middleware({
        request: new Request('https://app.jobhackai.io' + path), env: { ENVIRONMENT: 'production' },
        next: async () => { reachedHandler = true; return new Response('unexpected'); }
      });
      assert.equal(response.status, 404);
      assert.equal(reachedHandler, false);
    }
  });

  await t.test('missing and invalid credentials cannot read diagnostic storage', async () => {
    assert.equal((await run({ bearer: null })).status, 401);
    assert.equal((await run({ bearer: 'invalid' })).status, 401);
    assert.deepEqual(calls, []);
  });

  await t.test('signed-in users cannot read private keys or write test keys even in QA', async () => {
    for (const key of ['resume:user-b:123', 'user:user-b:lastResume', 'cusByUid:user-b', 'test:arbitrary', 'config:ats:private']) {
      const response = await run({ path: '/api/kv-test?key=' + encodeURIComponent(key) });
      assert.equal(response.status, 400, key);
      assert.doesNotMatch(await response.text(), /enabled/);
    }
    assert.deepEqual(calls, []);
  });

  await t.test('explicit dev and QA diagnostics retain read-only access to the allowed config', async () => {
    for (const environment of ['qa', 'dev', 'development', ' QA ']) {
      for (const path of ['/api/kv-test', '/api/kv-test?key=config%3Aats']) {
        const response = await run({ environment, path });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).kvValueParsed, { enabled: true });
      }
    }
    assert.equal(calls.length, 8);
    assert.ok(calls.every(([method, key]) => method === 'get' && key === 'config:ats'));
  });
});
