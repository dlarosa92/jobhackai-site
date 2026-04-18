import { isProductionEnvironment, notFoundInProductionResponse } from './_lib/debug-access.js';

const PRODUCTION_ONLY_DEBUG_PATHS = new Set([
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

export async function onRequest({ request, next, env }) {
  const pathname = request ? new URL(request.url).pathname.replace(/\/+$/, '') || '/' : null;

  if (pathname && isProductionEnvironment(env) && PRODUCTION_ONLY_DEBUG_PATHS.has(pathname)) {
    return notFoundInProductionResponse();
  }

  const res = await next();
  const h = new Headers(res.headers);

  // Security headers — applied on ALL environments
  h.set('x-content-type-options', 'nosniff');
  h.set('x-frame-options', 'DENY');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');

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
