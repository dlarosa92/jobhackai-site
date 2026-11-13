import {
  isExplicitNonProductionEnvironment,
  notFoundInProductionResponse,
  STANDARD_SECURITY_HEADERS,
  contentSecurityPolicy,
  createCspNonce
} from './_lib/debug-access.js';
import { isDevCutoverPaused } from './_lib/dev-cutover.js';

const HTML_CONTENT_TYPE = /^text\/html\b/i;

// An HTML document's nonce lives in both its body and its CSP header, so the
// two must always be produced together. A 304 would pair a fresh header with
// a browser-cached body (stale nonces, or none at all for a copy cached
// before this policy shipped) and every inline script would be blocked. So a
// document navigation is never revalidated: its validators are dropped before
// the asset layer sees them. Returns null when there is nothing to strip.
function documentRequestWithoutValidators(request) {
  const headers = request?.headers;
  if (!headers || typeof headers.get !== 'function') return null;
  if (request.method !== 'GET' || !(headers.get('accept') || '').includes('text/html')) return null;
  if (!headers.has('if-none-match') && !headers.has('if-modified-since')) return null;
  const stripped = new Headers(headers);
  stripped.delete('if-none-match');
  stripped.delete('if-modified-since');
  return new Request(request, { headers: stripped });
}

// Diagnostic pages/endpoints, reachable ONLY when ENVIRONMENT is explicitly
// a known non-production value (fail closed: a missing or misspelled
// ENVIRONMENT blocks them instead of exposing them).
const NON_PRODUCTION_ONLY_DEBUG_PATHS = new Set([
  '/api/ats-health',
  '/api/kv-test',
  '/api/test-openai',
  '/auth-test',
  '/auth-test.html',
  '/dashboard-simple',
  '/dashboard-simple.html',
  '/debug-stripe',
  '/env-test',
  '/simple-test',
  '/simple-test.html',
  '/stripe-key-test',
  '/stripe-test',
  '/stripe-test.html',
  '/voice-connection-check',
  '/voice-connection-check.html',
  '/voice-coaching-check',
  '/voice-coaching-check.html',
  '/api/voice/qa-coaching',
  '/text-model-check',
  '/text-model-check.html',
  '/api/qa/text'
]);

// Retired legacy routes, blocked in EVERY environment as a second layer of
// defense: even if a deleted legacy file (e.g. api/stripe.js — the
// unauthenticated legacy handler) is accidentally restored, the route stays
// closed. Keep in sync with the retired-file list in the hotfix runbook.
const RETIRED_PATHS = new Set([
  '/api/stripe',
  '/api/subscription',
  '/api/auth'
]);

export async function onRequest({ request, next, env }) {
  // Covers webhook deliveries and GET handlers that can write, as well as
  // POST requests. Stripe retries the 503; no event is acknowledged or lost.
  if (isDevCutoverPaused(env)) {
    return new Response('Development maintenance in progress. Please try again shortly.', {
      status: 503,
      headers: {
        ...STANDARD_SECURITY_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '120',
        'x-jobhackai-maintenance': 'dev-cutover'
      }
    });
  }
  const pathname = request ? new URL(request.url).pathname.replace(/\/+$/, '') || '/' : null;

  if (pathname && RETIRED_PATHS.has(pathname)) {
    return notFoundInProductionResponse();
  }

  if (pathname && NON_PRODUCTION_ONLY_DEBUG_PATHS.has(pathname) && !isExplicitNonProductionEnvironment(env)) {
    return notFoundInProductionResponse();
  }

  const upstreamRequest = documentRequestWithoutValidators(request);
  const res = upstreamRequest ? await next(upstreamRequest) : await next();
  const h = new Headers(res.headers);
  let body = res.body;

  // Security headers — applied on ALL environments (shared with notFoundInProductionResponse)
  for (const [name, value] of Object.entries(STANDARD_SECURITY_HEADERS)) {
    h.set(name, value);
  }

  // HTML documents (static pages and function-rendered ones alike) get a
  // per-response nonce: stamped on every <script> element and named in
  // script-src, which carries no 'unsafe-inline'. Markup injected into the DOM
  // later never has the nonce, so injected inline scripts and inline event
  // handlers cannot run. Without HTMLRewriter (not the Workers runtime) the
  // nonce-less policy above stays in force: fail closed.
  if (body && res.status !== 304 && HTML_CONTENT_TYPE.test(h.get('content-type') || '') && typeof HTMLRewriter !== 'undefined') {
    const nonce = createCspNonce();
    h.set('content-security-policy', contentSecurityPolicy(nonce));
    // The nonce is single-use: no shared cache may store this response, and
    // no validator may let a browser pair this body with a later header.
    h.delete('etag');
    h.delete('last-modified');
    h.delete('content-length');
    if (!/no-store/i.test(h.get('cache-control') || '')) h.set('cache-control', 'private, no-cache');
    body = new HTMLRewriter()
      .on('script', { element(element) { element.setAttribute('nonce', nonce); } })
      .transform(res).body;
  }

  // Voice interview needs the same-origin microphone. Mirrors the
  // /voice-interview rule in app/public/_headers: middleware set() overrides
  // the _headers layer on every route, so the exception must live here too.
  if (pathname === '/voice-interview' || pathname === '/voice-interview.html') {
    h.set('permissions-policy', 'camera=(), microphone=(self), geolocation=()');
  }

  // QA-only: prevent indexing and disable caching
  if (env.ENVIRONMENT === 'qa') {
    h.set('x-qa-mw', 'hit');
    h.set('x-robots-tag', 'noindex, nofollow');
    h.set('cache-control', 'no-store, no-cache, must-revalidate');
    h.set('pragma', 'no-cache');
    h.set('expires', '0');
  }

  return new Response(body, { status: res.status, statusText: res.statusText, headers: h });
}
