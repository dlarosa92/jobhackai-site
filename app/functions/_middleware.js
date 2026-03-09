export async function onRequest({ next, env }) {
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
