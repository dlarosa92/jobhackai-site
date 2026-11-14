// Security hardening regression suite.
// Run: node --test app/functions/_lib/__tests__/security-hardening.test.mjs
//
// Covers: the operator secret (X-Admin-Key), the admin and cron endpoints that
// require it, the diagnostic endpoints, token material in logs, and the script
// Content-Security-Policy (per-response nonce, no 'unsafe-inline').

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { hasValidAdminKey } from '../admin-auth.js';
import { CONTENT_SECURITY_POLICY, contentSecurityPolicy, createCspNonce } from '../debug-access.js';
import { onRequest as rootMiddleware } from '../../_middleware.js';
import { onRequest as cronSync } from '../../cron/kv-d1-sync.js';
import { onRequest as detectGaps } from '../../api/admin/detect-gaps.js';
import { onRequest as roleTemplates } from '../../api/admin/role-templates.js';
import { onRequest as generateRoleTemplate } from '../../api/admin/generate-role-template.js';
import { onRequest as kvTest } from '../../api/kv-test.js';
import { onRequest as healthEnv } from '../../api/health-env.js';
import { onRequest as echoAuth } from '../../api/echo-auth.js';
import { onRequest as linkedinCallback } from '../../api/auth/linkedin/callback.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ADMIN = 'fixture-admin-key';
const req = (url, init) => new Request(url, init);
const scriptSrc = (csp) => (csp || '').split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) || '';

// ---------------------------------------------------------------- admin key

test('admin key: only the exact X-Admin-Key value is accepted', async () => {
  const env = { ADMIN_API_KEY: ADMIN };
  const withKey = (headers) => hasValidAdminKey(req('https://dev.jobhackai.io/x', { headers }), env);
  assert.equal(await withKey({ 'X-Admin-Key': ADMIN }), true);
  assert.equal(await withKey({ 'X-Admin-Key': ADMIN + 'x' }), false);
  assert.equal(await withKey({ 'X-Admin-Key': ADMIN.slice(0, -1) }), false);
  assert.equal(await withKey({ 'X-Admin-Key': '' }), false);
  assert.equal(await withKey({}), false);
  assert.equal(await withKey({ 'X-Admin-Key': 'a'.repeat(2000) }), false);
  // Bearer is reserved for Firebase ID tokens and is never an admin credential.
  assert.equal(await withKey({ Authorization: `Bearer ${ADMIN}` }), false);
});

test('admin key: a missing or empty configured secret fails closed', async () => {
  for (const env of [{}, { ADMIN_API_KEY: '' }, { ADMIN_API_KEY: undefined }, undefined]) {
    assert.equal(await hasValidAdminKey(req('https://dev.jobhackai.io/x', { headers: { 'X-Admin-Key': '' } }), env), false);
    assert.equal(await hasValidAdminKey(req('https://dev.jobhackai.io/x', { headers: { 'X-Admin-Key': 'undefined' } }), env), false);
  }
});

test('admin endpoints: refuse without the key, refuse a Bearer key, admit X-Admin-Key', async () => {
  const cases = [
    [detectGaps, 'https://dev.jobhackai.io/api/admin/detect-gaps', 'GET'],
    [roleTemplates, 'https://dev.jobhackai.io/api/admin/role-templates', 'GET'],
    [generateRoleTemplate, 'https://dev.jobhackai.io/api/admin/generate-role-template', 'POST']
  ];
  for (const [handler, url, method] of cases) {
    const env = { ADMIN_API_KEY: ADMIN };
    const call = (headers) => handler({ request: req(url, { method, headers, body: method === 'POST' ? '{}' : undefined }), env });
    assert.equal((await call({})).status, 401, `${url} without a key`);
    assert.equal((await call({ Authorization: `Bearer ${ADMIN}` })).status, 401, `${url} with a Bearer key`);
    assert.equal((await call({ 'X-Admin-Key': 'wrong' })).status, 401, `${url} with a wrong key`);
    // Admitted: the handler runs and reports its own state (no database or body here), not 401.
    assert.notEqual((await call({ 'X-Admin-Key': ADMIN, 'Content-Type': 'application/json' })).status, 401, `${url} with the key`);
    // No configured secret: nothing is admitted.
    assert.equal((await handler({ request: req(url, { method, headers: { 'X-Admin-Key': '' } }), env: {} })).status, 401);
  }
});

// --------------------------------------------------------------------- cron

test('cron kv-d1-sync: never touches KV without the operator secret', async () => {
  let listed = 0;
  const kv = { list: async () => { listed++; return { keys: [], list_complete: true }; }, get: async () => null, put: async () => {} };
  const url = 'https://dev.jobhackai.io/cron/kv-d1-sync';
  for (const headers of [{}, { 'X-Admin-Key': 'wrong' }, { Authorization: `Bearer ${ADMIN}` }]) {
    const res = await cronSync({ request: req(url, { headers }), env: { ADMIN_API_KEY: ADMIN, JOBHACKAI_KV: kv } });
    assert.equal(res.status, 401);
  }
  assert.equal((await cronSync({ request: req(url), env: { JOBHACKAI_KV: kv } })).status, 401, 'no configured secret');
  assert.equal(listed, 0, 'KV must not be scanned by an unauthenticated caller');
  const ok = await cronSync({ request: req(url, { headers: { 'X-Admin-Key': ADMIN } }), env: { ADMIN_API_KEY: ADMIN, JOBHACKAI_KV: kv } });
  assert.equal(ok.status, 200);
  assert.equal(listed, 1);
});

// ------------------------------------------------------------------ kv-test

test('kv-test: not reachable unless ENVIRONMENT is explicitly non-production', async () => {
  const kv = { get: async () => 'secret-value', put: async () => {} };
  for (const environment of [undefined, '', 'prod', 'production', 'PROD', 'prd', 'staging']) {
    const res = await kvTest({ request: req('https://app.jobhackai.io/api/kv-test?key=config:ats', { headers: { Authorization: 'Bearer x' } }),
      env: { ENVIRONMENT: environment, JOBHACKAI_KV: kv } });
    assert.equal(res.status, 404, `ENVIRONMENT=${environment}`);
    assert.ok(!(await res.text()).includes('secret-value'));
  }
  // The middleware blocks the route too, before any handler runs.
  for (const environment of [undefined, 'prod', 'production']) {
    let reached = false;
    const res = await rootMiddleware({ request: { url: 'https://app.jobhackai.io/api/kv-test' }, env: { ENVIRONMENT: environment },
      next: async () => { reached = true; return new Response('x'); } });
    assert.equal(res.status, 404);
    assert.equal(reached, false);
  }
});

test('kv-test: in dev it still requires a valid token and never returns verifier detail', async () => {
  const kv = { get: async () => 'secret-value', put: async () => {} };
  const env = { ENVIRONMENT: 'dev', FIREBASE_PROJECT_ID: 'fixture', JOBHACKAI_KV: kv };
  const none = await kvTest({ request: req('https://dev.jobhackai.io/api/kv-test'), env });
  assert.equal(none.status, 401);
  const bad = await kvTest({ request: req('https://dev.jobhackai.io/api/kv-test', { headers: { Authorization: 'Bearer not.a.token' } }), env });
  assert.equal(bad.status, 401);
  const body = await bad.text();
  assert.ok(!body.includes('secret-value'));
  assert.deepEqual(JSON.parse(body), { success: false, error: 'Unauthorized' });
});

// Key boundaries (only config:ats, never account data, no writes) are covered
// with a real signed token in kv-test.test.mjs, shared with production.

// --------------------------------------------------------------- health-env

test('health-env: production accepts only the operator secret', async () => {
  const url = 'https://app.jobhackai.io/api/health-env';
  const env = { ENVIRONMENT: 'production', ADMIN_API_KEY: ADMIN, STRIPE_SECRET_KEY: 'sk_live_fixture_value', FIREBASE_PROJECT_ID: 'fixture' };
  assert.equal((await healthEnv({ request: req(url), env })).status, 401);
  // A signed-in customer token is not enough in production (and is not even verified).
  assert.equal((await healthEnv({ request: req(url, { headers: { Authorization: 'Bearer any.customer.token' } }), env })).status, 401);
  assert.equal((await healthEnv({ request: req(url, { headers: { 'X-Admin-Key': 'wrong' } }), env })).status, 401);
  const ok = await healthEnv({ request: req(url, { headers: { 'X-Admin-Key': ADMIN } }), env });
  assert.equal(ok.status, 200);
  const text = await ok.text();
  assert.equal(JSON.parse(text).present.STRIPE_SECRET_KEY.exists, true);
  assert.ok(!text.includes('sk_live_fixture_value') && !text.includes(ADMIN), 'existence only, never values');
  // Unset ENVIRONMENT is treated like production.
  assert.equal((await healthEnv({ request: req(url, { headers: { Authorization: 'Bearer any.customer.token' } }), env: { ADMIN_API_KEY: ADMIN } })).status, 401);
});

test('health-env: a bad token is refused in non-production as well', async () => {
  const res = await healthEnv({ request: req('https://dev.jobhackai.io/api/health-env', { headers: { Authorization: 'Bearer not.a.token' } }),
    env: { ENVIRONMENT: 'dev', FIREBASE_PROJECT_ID: 'fixture' } });
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------- echo-auth

test('echo-auth: verifier diagnostics are never echoed', async () => {
  const res = await echoAuth({ request: req('https://dev.jobhackai.io/api/echo-auth', { headers: { authorization: 'Bearer not.a.token' } }),
    env: { FIREBASE_PROJECT_ID: 'fixture-project' } });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, error: 'invalid_token' });
});

// ------------------------------------------------------- linkedin callback

test('linkedin callback: a token response without id_token is never logged', async () => {
  const secret = 'state-secret';
  const state = `${crypto.randomUUID()}:${Math.floor(Date.now() / 1000)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(state)))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const logged = [];
  const originalError = console.error, originalFetch = globalThis.fetch;
  console.error = (...args) => logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  globalThis.fetch = async () => Response.json({ access_token: 'LIVE-ACCESS-TOKEN-VALUE', expires_in: 5184000, scope: 'openid' });
  try {
    const res = await linkedinCallback({
      request: req(`https://dev.jobhackai.io/api/auth/linkedin/callback?code=abc&state=${encodeURIComponent(state)}`,
        { headers: { Cookie: `linkedin_oauth_state=${encodeURIComponent(`${state}|${sig}`)}` } }),
      env: { LINKEDIN_STATE_SECRET: secret, LINKEDIN_CLIENT_ID: 'id', LINKEDIN_CLIENT_SECRET: 'client-secret', FIREBASE_WEB_API_KEY: 'k' }
    });
    assert.equal(res.status, 500);
  } finally {
    console.error = originalError; globalThis.fetch = originalFetch;
  }
  assert.equal(logged.length, 1, 'the failure is still logged');
  assert.ok(logged[0].includes('access_token'), 'field names are logged for diagnosis');
  assert.ok(!logged.join('\n').includes('LIVE-ACCESS-TOKEN-VALUE'), 'token values are not logged');
});

// ---------------------------------------------------------------------- CSP

test('CSP: script-src never allows unsafe-inline or unsafe-eval', () => {
  const nonce = createCspNonce();
  for (const policy of [CONTENT_SECURITY_POLICY, contentSecurityPolicy(), contentSecurityPolicy(nonce)]) {
    const src = scriptSrc(policy);
    assert.ok(src.startsWith("script-src 'self'"));
    assert.ok(!src.includes("'unsafe-inline'"), src);
    assert.ok(!src.includes("'unsafe-eval'"), src);
    assert.ok(!/\s(\*|https?:|data:)(\s|$)/.test(src), 'no wildcard or scheme-wide script source');
  }
  assert.ok(!scriptSrc(CONTENT_SECURITY_POLICY).includes('nonce-'));
  assert.ok(scriptSrc(contentSecurityPolicy(nonce)).includes(`'nonce-${nonce}'`));
});

test('CSP: nonces are unpredictable and unique', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const nonce = createCspNonce();
    assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
    seen.add(nonce);
  }
  assert.equal(seen.size, 500);
});

test('CSP: app/public/_headers carries the same nonce-less policy', () => {
  const headers = readFileSync(path.join(repoRoot, 'app/public/_headers'), 'utf8');
  const lines = headers.split('\n').filter((line) => line.trim().startsWith('Content-Security-Policy:'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].trim().slice('Content-Security-Policy:'.length).trim(), CONTENT_SECURITY_POLICY);
});

// Minimal stand-in for the Workers HTMLRewriter (absent in Node). Attributes
// keep insertion order, as the real rewriter serializes them.
class FakeHTMLRewriter {
  on(selector, handlers) { assert.equal(selector, 'script'); this.handlers = handlers; return this; }
  transform(response) {
    const { handlers } = this;
    return new Response(new ReadableStream({
      async start(controller) {
        const text = await response.text();
        controller.enqueue(new TextEncoder().encode(text.replace(/<script\b([^>]*)>/gi, (match, raw) => {
          let attributes = [...raw.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? '']);
          handlers.element({
            get attributes() { return attributes[Symbol.iterator](); },
            removeAttribute(name) { attributes = attributes.filter(([n]) => n !== name); },
            setAttribute(name, value) {
              const existing = attributes.find(([n]) => n === name);
              if (existing) existing[1] = value; else attributes.push([name, value]);
            }
          });
          return `<script${attributes.map(([n, v]) => ` ${n}="${v}"`).join('')}>`;
        })));
        controller.close();
      }
    }));
  }
}

async function throughMiddleware({ url = 'https://dev.jobhackai.io/dashboard.html', requestHeaders = { accept: 'text/html,application/xhtml+xml' },
  body = '<html><head><script>inline()</script><script src="/js/a.js"></script></head><body><script type="module">m()</script></body></html>',
  responseHeaders = { 'content-type': 'text/html; charset=utf-8', etag: '"abc"', 'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT',
    'content-length': '999', 'cache-control': 'public, max-age=0, must-revalidate' },
  status = 200, env = { ENVIRONMENT: 'dev' }, rewriter = FakeHTMLRewriter } = {}) {
  const previous = globalThis.HTMLRewriter;
  if (rewriter) globalThis.HTMLRewriter = rewriter; else delete globalThis.HTMLRewriter;
  const seen = {};
  try {
    const res = await rootMiddleware({ request: req(url, { headers: requestHeaders }), env,
      next: async (upstream) => { seen.upstream = upstream; return new Response(status === 304 ? null : body, { status, headers: responseHeaders }); } });
    return { res, text: status === 304 ? '' : await res.text(), seen };
  } finally {
    if (previous) globalThis.HTMLRewriter = previous; else delete globalThis.HTMLRewriter;
  }
}

test('CSP: every script element of an HTML document carries the nonce named in its header', async () => {
  const { res, text } = await throughMiddleware();
  const src = scriptSrc(res.headers.get('content-security-policy'));
  const nonce = /'nonce-([^']+)'/.exec(src)?.[1];
  assert.ok(nonce, 'header names a nonce');
  assert.ok(!src.includes("'unsafe-inline'"));
  const tags = text.match(/<script\b[^>]*>/g);
  assert.equal(tags.length, 3);
  for (const tag of tags) assert.ok(tag.includes(`nonce="${nonce}"`), tag);
  const second = await throughMiddleware();
  assert.notEqual(/'nonce-([^']+)'/.exec(second.res.headers.get('content-security-policy'))[1], nonce, 'a new nonce per response');
});

// Cloudflare Rocket Loader re-creates scripts without the nonce, which the CSP
// then blocks. Every script must carry the documented opt-out, placed before src.
test('CSP: every script opts out of Cloudflare Rocket Loader, with data-cfasync before src', async () => {
  const { text } = await throughMiddleware({
    body: '<html><head><script src="js/a.js?v=1" defer></script><script type="module" src="js/m.js"></script>'
      + '<script>inline()</script><script async src="https://www.googletagmanager.com/gtag/js" data-cfasync="true" nonce="stale"></script></head></html>'
  });
  const tags = text.match(/<script\b[^>]*>/g);
  assert.equal(tags.length, 4);
  for (const tag of tags) {
    assert.ok(tag.startsWith('<script data-cfasync="false"'), `opt-out must be the first attribute: ${tag}`);
    assert.equal(tag.match(/data-cfasync=/g).length, 1, tag);
    assert.equal(tag.match(/nonce=/g).length, 1, tag);
    assert.ok(!tag.includes('nonce="stale"'), tag);
    if (tag.includes(' src=')) assert.ok(tag.indexOf('data-cfasync') < tag.indexOf(' src='), tag);
  }
  // Nothing else about the tags changes.
  assert.ok(tags[0].includes(' src="js/a.js?v=1"') && tags[0].includes(' defer='));
  assert.ok(tags[1].includes(' type="module"') && tags[1].includes(' src="js/m.js"'));
  assert.ok(tags[3].includes(' async=') && tags[3].includes(' src="https://www.googletagmanager.com/gtag/js"'));
});

test('CSP: a nonced document cannot be cached by a shared cache or revalidated', async () => {
  const { res } = await throughMiddleware();
  assert.equal(res.headers.get('etag'), null);
  assert.equal(res.headers.get('last-modified'), null);
  assert.equal(res.headers.get('content-length'), null);
  assert.equal(res.headers.get('cache-control'), 'private, no-cache');
  // An upstream no-store is never weakened.
  const noStore = await throughMiddleware({ responseHeaders: { 'content-type': 'text/html', 'cache-control': 'no-store' } });
  assert.equal(noStore.res.headers.get('cache-control'), 'no-store');
});

test('CSP: document navigations are never revalidated, so a 304 cannot pair a new nonce with a cached body', async () => {
  const conditional = await throughMiddleware({ requestHeaders: { accept: 'text/html', 'if-none-match': '"abc"', 'if-modified-since': 'Mon, 01 Jan 2024 00:00:00 GMT', cookie: 'a=b' } });
  assert.ok(conditional.seen.upstream instanceof Request, 'the asset layer receives a rewritten request');
  assert.equal(conditional.seen.upstream.headers.get('if-none-match'), null);
  assert.equal(conditional.seen.upstream.headers.get('if-modified-since'), null);
  assert.equal(conditional.seen.upstream.headers.get('cookie'), 'a=b', 'other headers are preserved');
  assert.equal(conditional.seen.upstream.url, 'https://dev.jobhackai.io/dashboard.html');
  // Subresources keep their validators and their 304s.
  const asset = await throughMiddleware({ url: 'https://dev.jobhackai.io/js/a.js', requestHeaders: { accept: '*/*', 'if-none-match': '"abc"' },
    status: 304, responseHeaders: { etag: '"abc"' } });
  assert.equal(asset.seen.upstream, undefined, 'subresource requests pass through untouched');
  assert.equal(asset.res.status, 304);
  assert.equal(asset.res.headers.get('etag'), '"abc"');
});

test('CSP: non-HTML responses get the nonce-less policy and keep their validators', async () => {
  const { res, text } = await throughMiddleware({ url: 'https://dev.jobhackai.io/js/a.js', requestHeaders: { accept: '*/*' },
    body: 'const a = "<script>";', responseHeaders: { 'content-type': 'application/javascript', etag: '"abc"', 'cache-control': 'public, max-age=0, must-revalidate' } });
  assert.equal(res.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  assert.equal(res.headers.get('etag'), '"abc"');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(text, 'const a = "<script>";');
});

test('CSP: without HTMLRewriter the nonce-less policy stays in force (fail closed)', async () => {
  const { res, text } = await throughMiddleware({ rewriter: null });
  assert.equal(res.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  assert.ok(!text.includes('nonce='));
});

// Inline event handlers and javascript: URLs are blocked by the policy, so any
// that ship would be silently dead buttons. Keep them out of deployed sources.
test('CSP: deployed pages and scripts contain no inline event handlers or javascript: URLs', () => {
  const files = [];
  const walk = (dir, filter) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== 'vendor' && name !== 'node_modules') walk(full, filter); }
      else if (filter(name)) files.push(full);
    }
  };
  for (const name of readdirSync(repoRoot)) if (name.endsWith('.html')) files.push(path.join(repoRoot, name));
  walk(path.join(repoRoot, 'js'), (name) => name.endsWith('.js'));
  walk(path.join(repoRoot, 'app/public'), (name) => name.endsWith('.html'));
  walk(path.join(repoRoot, 'app/src'), (name) => /\.(tsx?|jsx?)$/.test(name));
  walk(path.join(repoRoot, 'app/functions'), (name) => name.endsWith('.js') && !name.includes('.test.'));
  assert.ok(files.length > 60, `scanned ${files.length} files`);
  // An attribute inside a tag: <tag ... onxxx="..."> in any quote style, across
  // line breaks, including markup built in template strings.
  const inlineHandler = /<[a-zA-Z][^<>]*?[\s"'`]on[a-z]{3,}\s*=\s*\\?["'`]/g;
  const javascriptUrl = /(?:href|src|action|formaction)\s*=\s*\\?["'`]\s*javascript:/gi;
  // The patterns must recognise the forms that used to ship.
  for (const legacy of [
    '<button class="btn" onclick="resetPassword()">',
    'html += `<button type="button" onclick="openBillingPortal()">Billing</button>`;',
    '<button id="x" style="\n  color: red;\n" onmouseover="this.style.background=\'#fff\'">',
    "<img src=x onerror='steal()'>",
    '<a href="#" onclick=\\"go()\\">'
  ]) {
    inlineHandler.lastIndex = 0;
    assert.ok(inlineHandler.test(legacy), `pattern must match: ${legacy}`);
  }
  assert.ok(/(?:href)\s*=\s*["']\s*javascript:/i.test('<a href="javascript:void(0)">'));
  for (const allowed of ['script.onload = function () {};', 'el.onclick = handler;', '<button data-jh-click="resetPassword">', 'a < b && (x.onerror = "y")']) {
    inlineHandler.lastIndex = 0;
    assert.ok(!inlineHandler.test(allowed), `pattern must not match: ${allowed}`);
  }
  const offenders = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of [inlineHandler, javascriptUrl]) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
        const line = source.slice(0, match.index + match[0].length).split('\n').length;
        offenders.push(`${path.relative(repoRoot, file)}:${line}: ${match[0].replace(/\s+/g, ' ').slice(-80)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'bind events with addEventListener instead');
});
