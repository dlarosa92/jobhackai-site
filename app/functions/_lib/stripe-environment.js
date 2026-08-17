// Single source of truth for mapping the deployment environment to the
// Stripe mode it is allowed to touch. Production is live-mode only; QA and
// dev are test-mode only. Nothing else in the billing code may compare
// env.ENVIRONMENT strings directly — use these helpers so the deployed
// value `PROD` (and any casing/whitespace variant) keeps working.

const PRODUCTION_NAMES = new Set(['prod', 'production']);
const NON_PRODUCTION_NAMES = new Set(['qa', 'dev', 'development']);

export function normalizeEnvironmentName(env) {
  return String(env?.ENVIRONMENT || '').trim().toLowerCase();
}

// 'live' | 'test' | null — derived from the configured secret key prefix.
// Restricted keys (rk_) carry the same mode prefixes as secret keys.
export function keyMode(env) {
  const key = String(env?.STRIPE_SECRET_KEY || '');
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  return null;
}

// The livemode value Stripe events must carry to be processed here.
//   prod / production      → { expected: true }
//   qa / dev / development → { expected: false }
//   anything else          → { expected: null, configError: true }
// Fully fail-closed: a missing, unknown, or misspelled ENVIRONMENT is a
// configuration error even when the configured key is live-mode. The
// environment is never inferred from the key — inferring it is how a
// mis-configured environment silently processes the wrong mode.
export function resolveExpectedLivemode(env) {
  const name = normalizeEnvironmentName(env);
  if (PRODUCTION_NAMES.has(name)) return { expected: true };
  if (NON_PRODUCTION_NAMES.has(name)) return { expected: false };
  return { expected: null, configError: true };
}

// Guard for every endpoint that can mutate billing state outside the
// webhook (checkout, sync, upgrade, cancel, portal). Returns { ok:false }
// when the configured key's mode contradicts the environment. Callers
// respond 503 and never echo the key.
export function assertStripeKeyMatchesEnvironment(env) {
  const { expected, configError } = resolveExpectedLivemode(env);
  if (configError) {
    return { ok: false, reason: 'ENVIRONMENT unset or unrecognized; refusing all Stripe activity' };
  }
  const mode = keyMode(env);
  if (expected === true && mode !== 'live') {
    return { ok: false, reason: 'production requires a live-mode Stripe key' };
  }
  if (expected === false && mode !== 'test') {
    return { ok: false, reason: 'non-production environments require a test-mode Stripe key' };
  }
  return { ok: true };
}

// Log-safe form of any identifier (Stripe IDs, Firebase UIDs). Keeps the
// type prefix and last 4 characters so operators can correlate without the
// log ever containing a usable identifier.
export function redactId(value) {
  const s = String(value ?? '');
  if (!s) return '(none)';
  if (s.length <= 8) return `${s.slice(0, 2)}…`;
  const underscore = s.indexOf('_');
  const prefix = underscore > 0 && underscore <= 8 ? s.slice(0, underscore + 1) : s.slice(0, 3);
  return `${prefix}…${s.slice(-4)}`;
}
