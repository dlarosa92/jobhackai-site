const PRODUCTION_ENVIRONMENTS = new Set(['prod', 'production']);
const NON_PRODUCTION_ENVIRONMENTS = new Set(['qa', 'dev', 'development']);

// script-src never contains 'unsafe-inline'. Inline <script> blocks run only
// when they carry the per-response nonce that functions/_middleware.js adds to
// HTML documents; inline event-handler attributes (onclick="...") and
// javascript: URLs never run. Bind handlers with addEventListener instead.
const SCRIPT_HOSTS = "https://www.gstatic.com https://www.googleapis.com https://apis.google.com https://accounts.google.com https://www.googletagmanager.com https://www.google-analytics.com https://www.google.com https://js.stripe.com https://checkout.stripe.com https://*.firebaseapp.com";

/**
 * Build the Content-Security-Policy. With a nonce, inline scripts carrying
 * that nonce are allowed (HTML documents). Without one, no inline script is
 * allowed at all (API responses, 404s, any non-HTML asset).
 */
export function contentSecurityPolicy(nonce) {
  const scriptSrc = nonce ? `script-src 'self' 'nonce-${nonce}' ${SCRIPT_HOSTS}` : `script-src 'self' ${SCRIPT_HOSTS}`;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
    "img-src 'self' data: blob: https://www.gstatic.com https://www.google-analytics.com https://www.googletagmanager.com https://*.googleusercontent.com https://jobhackai.io https://app.jobhackai.io",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    scriptSrc,
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebaseinstallations.googleapis.com https://www.googleapis.com https://api.stripe.com https://checkout.stripe.com https://www.google-analytics.com https://region1.google-analytics.com https://stats.g.doubleclick.net https://*.firebaseio.com https://*.firebasedatabase.app https://*.firebaseapp.com https://api.openai.com",
    "frame-src 'self' https://accounts.google.com https://*.google.com https://*.firebaseapp.com https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' blob:"
  ].join('; ');
}

// Nonce-less policy: the default for every response that is not an HTML
// document. Keep app/public/_headers in sync with this value.
export const CONTENT_SECURITY_POLICY = contentSecurityPolicy();

/** 128 bits from the CSPRNG, base64. Never reuse a nonce across responses. */
export function createCspNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function normalizeEnvironmentName(environment) {
  return String(environment || '').trim().toLowerCase();
}

export function isProductionEnvironment(env) {
  return PRODUCTION_ENVIRONMENTS.has(normalizeEnvironmentName(env?.ENVIRONMENT));
}

/**
 * Fail-closed gate for debug/diagnostic endpoints: they are reachable ONLY
 * when ENVIRONMENT is explicitly a known non-production value. A missing,
 * unknown, or misspelled ENVIRONMENT blocks them — the old
 * !isProductionEnvironment() gate silently EXPOSED debug endpoints whenever
 * the variable was unset.
 */
export function isExplicitNonProductionEnvironment(env) {
  return NON_PRODUCTION_ENVIRONMENTS.has(normalizeEnvironmentName(env?.ENVIRONMENT));
}

/** Same values as middleware — keep in sync so prod 404 early-returns are not weaker. */
export const STANDARD_SECURITY_HEADERS = Object.freeze({
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload'
});

export function notFoundInProductionResponse(headers = {}) {
  return new Response('Not Found', {
    status: 404,
    headers: {
      ...STANDARD_SECURITY_HEADERS,
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}
