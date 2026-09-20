// Middleware security-header test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/middleware-headers.test.mjs
//
// Guards the voice-interview header carve-out: app/functions/_middleware.js
// force-sets STANDARD_SECURITY_HEADERS on every route (overriding whatever
// the static _headers layer produced), so the same-origin microphone
// exception and the OpenAI Realtime connect-src allowance must be applied
// at the middleware layer or /voice-interview cannot getUserMedia() or POST
// the WebRTC SDP offer to api.openai.com.

import assert from 'node:assert/strict';
import { onRequest } from '../../_middleware.js';

async function run(path, { env = {}, nextHeaders = {} } = {}) {
  const res = await onRequest({
    request: { url: `https://dev.jobhackai.io${path}` },
    next: async () => new Response('body', { headers: nextHeaders }),
    env
  });
  return res.headers;
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
  }
}

console.log('middleware security headers test suite\n');

await test('/voice-interview gets same-origin microphone', async () => {
  const h = await run('/voice-interview');
  assert.equal(h.get('permissions-policy'), 'camera=(), microphone=(self), geolocation=()');
});

await test('/voice-interview.html and trailing slash get the same carve-out', async () => {
  const html = await run('/voice-interview.html');
  assert.equal(html.get('permissions-policy'), 'camera=(), microphone=(self), geolocation=()');
  const slash = await run('/voice-interview/');
  assert.equal(slash.get('permissions-policy'), 'camera=(), microphone=(self), geolocation=()');
});

await test('every other route keeps the locked-down default', async () => {
  for (const path of ['/', '/dashboard', '/pricing', '/api/plan/me']) {
    const h = await run(path);
    assert.equal(h.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()', `path ${path}`);
  }
});

await test('CSP connect-src permits the OpenAI Realtime endpoint', async () => {
  const h = await run('/voice-interview');
  const csp = h.get('content-security-policy') || '';
  const connect = csp.split(';').find((d) => d.trim().startsWith('connect-src')) || '';
  assert.ok(connect.includes('https://api.openai.com'), 'connect-src must include https://api.openai.com');
});

await test('middleware overrides conflicting headers from the asset layer', async () => {
  // Simulates _headers (or an upstream) sending a different value: the
  // middleware's set() must win so behavior is deterministic per route.
  const locked = await run('/dashboard', { nextHeaders: { 'permissions-policy': 'microphone=(self)' } });
  assert.equal(locked.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  const voice = await run('/voice-interview', { nextHeaders: { 'permissions-policy': 'microphone=()' } });
  assert.equal(voice.get('permissions-policy'), 'camera=(), microphone=(self), geolocation=()');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
