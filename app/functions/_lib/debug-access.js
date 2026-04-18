const PRODUCTION_ENVIRONMENTS = new Set(['prod', 'production']);

function normalizeEnvironmentName(environment) {
  return String(environment || '').trim().toLowerCase();
}

export function isProductionEnvironment(env) {
  return PRODUCTION_ENVIRONMENTS.has(normalizeEnvironmentName(env?.ENVIRONMENT));
}

/** Same values as middleware — keep in sync so prod 404 early-returns are not weaker. */
export const STANDARD_SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
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
