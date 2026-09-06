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

// ── Environment stamps (dev/QA isolation) ───────────────────────────────
// Dev and QA both run Stripe TEST mode against one Stripe account today, so
// every test-mode event is delivered to BOTH webhooks. livemode cannot tell
// them apart; the objects each environment creates can. Checkout stamps
// metadata.environment = <canonical name> on the Checkout Session and on the
// subscription it creates, and the webhook ignores (200, zero writes) events
// whose object is stamped for a DIFFERENT environment — the test-mode
// analogue of the livemode gate. Un-stamped objects (created before the
// stamp existed, by the Stripe dashboard, or by `stripe trigger` fixtures)
// are processed exactly as before. Customers are deliberately NOT stamped:
// one Firebase user has one Stripe customer across environments.
//
// This is defence in depth, not isolation on its own: an environment running
// code without this gate still processes the other environment's objects.
// Real isolation is a separate Stripe sandbox/account per environment.
const CANONICAL = { prod: 'prod', production: 'prod', qa: 'qa', dev: 'dev', development: 'dev' };

// 'prod' | 'qa' | 'dev' | null for this deployment.
export function canonicalEnvironmentName(env) {
  return CANONICAL[normalizeEnvironmentName(env)] || null;
}

// Canonical form of a metadata.environment value; unknown non-empty values
// are returned as-is (they are foreign to every known environment).
export function canonicalizeEnvironmentStamp(value) {
  const name = String(value ?? '').trim().toLowerCase();
  if (!name) return null;
  return CANONICAL[name] || name;
}

// Form-encoded fields to add to a Checkout Session body. With
// { subscription: true } the stamp is also copied onto the subscription the
// session creates (subscription_data is only valid in subscription mode).
export function environmentStampFields(env, { subscription = false } = {}) {
  const stamp = canonicalEnvironmentName(env);
  if (!stamp) return {};
  const fields = { 'metadata[environment]': stamp };
  if (subscription) fields['subscription_data[metadata][environment]'] = stamp;
  return fields;
}

// Stamp carried by a webhook event's primary object: session/subscription
// metadata, or the subscription metadata snapshot on an invoice — which
// lives at invoice.subscription_details.metadata before Stripe API
// 2025-03-31.basil and at invoice.parent.subscription_details.metadata from
// basil onward (this account's default and the pinned endpoint versions).
// Invoice metadata itself (obj.metadata) is NOT consulted: it is not stamped.
export function eventEnvironmentStamp(event) {
  const obj = event?.data?.object || {};
  const isInvoice = obj?.object === 'invoice' || 'subscription_details' in obj || 'parent' in obj;
  const raw = isInvoice
    ? (obj?.subscription_details?.metadata?.environment ?? obj?.parent?.subscription_details?.metadata?.environment ?? null)
    : (obj?.metadata?.environment ?? null);
  return canonicalizeEnvironmentStamp(raw);
}

// True when the object is stamped for another environment. Un-stamped
// objects are never foreign.
export function isForeignEnvironmentStamp(env, stamp) {
  const canon = canonicalizeEnvironmentStamp(stamp); // raw or canonical input
  if (!canon) return false;
  const own = canonicalEnvironmentName(env);
  return own !== null && canon !== own;
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
