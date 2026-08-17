import {
  isExplicitNonProductionEnvironment,
  notFoundInProductionResponse,
  STANDARD_SECURITY_HEADERS
} from './_lib/debug-access.js';

// Diagnostic pages/endpoints, reachable ONLY when ENVIRONMENT is explicitly
// a known non-production value (fail closed: a missing or misspelled
// ENVIRONMENT blocks them instead of exposing them).
const NON_PRODUCTION_ONLY_DEBUG_PATHS = new Set([
  '/api/ats-health',
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
  '/stripe-test.html'
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
  const pathname = request ? new URL(request.url).pathname.replace(/\/+$/, '') || '/' : null;

  if (pathname && RETIRED_PATHS.has(pathname)) {
    return notFoundInProductionResponse();
  }

  if (pathname && NON_PRODUCTION_ONLY_DEBUG_PATHS.has(pathname) && !isExplicitNonProductionEnvironment(env)) {
    return notFoundInProductionResponse();
  }

  const res = await next();
  const h = new Headers(res.headers);

  // Security headers — applied on ALL environments (shared with notFoundInProductionResponse)
  for (const [name, value] of Object.entries(STANDARD_SECURITY_HEADERS)) {
    h.set(name, value);
  }

  // QA-only: prevent indexing and disable caching
  if (env.ENVIRONMENT === 'qa') {
    h.set('x-qa-mw', 'hit');
    h.set('x-robots-tag', 'noindex, nofollow');
    h.set('cache-control', 'no-store, no-cache, must-revalidate');
    h.set('pragma', 'no-cache');
    h.set('expires', '0');
  }

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
