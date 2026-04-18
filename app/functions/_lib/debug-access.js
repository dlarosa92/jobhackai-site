const PRODUCTION_ENVIRONMENTS = new Set(['prod', 'production']);

function normalizeEnvironmentName(environment) {
  return String(environment || '').trim().toLowerCase();
}

export function isProductionEnvironment(env) {
  return PRODUCTION_ENVIRONMENTS.has(normalizeEnvironmentName(env?.ENVIRONMENT));
}

export function notFoundInProductionResponse(headers = {}) {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}
