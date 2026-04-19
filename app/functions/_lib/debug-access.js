const PRODUCTION_ENVIRONMENTS = new Set(['prod', 'production']);
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
  "img-src 'self' data: blob: https://www.gstatic.com https://www.google-analytics.com https://www.googletagmanager.com https://*.googleusercontent.com https://jobhackai.io https://app.jobhackai.io",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://www.googleapis.com https://apis.google.com https://accounts.google.com https://www.googletagmanager.com https://www.google-analytics.com https://www.google.com https://js.stripe.com https://checkout.stripe.com https://*.firebaseapp.com",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebaseinstallations.googleapis.com https://www.googleapis.com https://api.stripe.com https://checkout.stripe.com https://www.google-analytics.com https://region1.google-analytics.com https://stats.g.doubleclick.net https://*.firebaseio.com https://*.firebasedatabase.app https://*.firebaseapp.com",
  "frame-src 'self' https://accounts.google.com https://*.google.com https://*.firebaseapp.com https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:"
].join('; ');

function normalizeEnvironmentName(environment) {
  return String(environment || '').trim().toLowerCase();
}

export function isProductionEnvironment(env) {
  return PRODUCTION_ENVIRONMENTS.has(normalizeEnvironmentName(env?.ENVIRONMENT));
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
