import { canonicalEnvironmentName } from './stripe-environment.js';

// Nonproduction cookies must never reuse a production browser identity even
// when siblings share the jobhackai.io cookie domain for a QA journey.
export function analyticsClientIdentity(request, env) {
  const environment = canonicalEnvironmentName(env);
  if (!environment) return { clientId: null, error: 'environment_unavailable' };
  const name = environment === 'prod' ? 'jha_client_id' : `jha_client_id_${environment}`;
  const values = (request.headers.get('Cookie') || '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(name + '='))
    .map(value => value.slice(name.length + 1));
  // Conflicting host/domain cookies cannot silently select another identity.
  if (!values.length) return { clientId: null };
  if (new Set(values).size !== 1) return { clientId: null, error: 'ambiguous_client' };
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(values[0])
    ? { clientId: values[0] } : { clientId: null, error: 'invalid_client' };
}

export function analyticsClientId(request, env) {
  return analyticsClientIdentity(request, env).clientId;
}
