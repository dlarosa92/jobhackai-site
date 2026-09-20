import { getDb } from './db.js';
import { canonicalEnvironmentName } from './stripe-environment.js';

const WINDOW_MS = 90 * 86400000;
const CLOCK_SKEW_MS = 5 * 60000;
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function touch(value, now) {
  if (!value || !Number.isSafeInteger(value.at) || value.at > now + CLOCK_SKEW_MS || value.at < now - WINDOW_MS) return null;
  // Browser timestamps are untrusted and devices can be slightly ahead.
  // Bound skew, then clamp accepted future times to the server receipt.
  const result = { at: Math.min(value.at, now) };
  for (const key of ['source', 'medium', 'campaign', 'asset', 'id']) {
    if (value[key] != null) {
      if (typeof value[key] !== 'string' || !/^[a-z0-9_.-]{1,100}$/i.test(value[key])) return null;
      result[key] = value[key];
    }
  }
  return result.source && result.medium && result.campaign ? result : null;
}

export function normalizeCheckoutAnalytics(value, now = Date.now()) {
  if (!value || value.analyticsConsent !== true) return null;
  return {
    gaClientId: typeof value.gaClientId === 'string' && /^\d{1,20}\.\d{1,20}$/.test(value.gaClientId) ? value.gaClientId : null,
    gaSessionId: typeof value.gaSessionId === 'string' && /^\d{1,20}$/.test(value.gaSessionId) ? value.gaSessionId : null,
    first: touch(value.firstTouch, now), last: touch(value.lastTouch, now)
  };
}

// Called before returning the Stripe redirect. Does not alter Stripe request
// parameters/idempotency, and never overwrites a checkout's original context.
// Failed analytics storage does not prevent payment; it remains unattributed.
export async function saveCheckoutAttribution(env, { request, session, uid, customerId, analytics }) {
  const now = Date.now(), context = normalizeCheckoutAnalytics(analytics, now);
  const clientId = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)jha_client_id=([^;]*)/)?.[1];
  const environment = canonicalEnvironmentName(env);
  if (!context || !environment || !CLIENT_ID.test(clientId || '') || session?.status !== 'open'
    || !/^cs_[a-z0-9_]+$/i.test(session?.id || '') || session.customer !== customerId) return false;
  try {
    const db = getDb(env);
    if (!db) return false;
    // A browser's assertion is insufficient. The authenticated account must
    // have a persisted grant at the instant this SQL runs. An anonymous
    // rejection on the same browser also vetoes it.
    const result = await db.prepare(`INSERT INTO checkout_attributions
      (checkout_session_id, user_id, client_id, stripe_customer_id, environment,
       ga_client_id, ga_session_id, first_touch_json, last_touch_json, captured_at, expires_at)
      SELECT ?1, u.id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
      FROM users u JOIN cookie_consents c ON c.user_id = u.id
      WHERE u.auth_id = ?11
        AND CASE WHEN json_valid(c.consent_json) THEN
          json_extract(c.consent_json, '$.version') = 1 AND json_type(c.consent_json, '$.analytics') = 'true'
          ELSE 0 END
        AND NOT EXISTS (SELECT 1 FROM cookie_consents a WHERE a.client_id = ?2 AND
          CASE WHEN json_valid(a.consent_json) THEN COALESCE(
            json_extract(a.consent_json, '$.version') = 1 AND json_type(a.consent_json, '$.analytics') = 'true', 0) = 0 ELSE 1 END)
      ON CONFLICT(checkout_session_id) DO NOTHING`)
      .bind(session.id, clientId, customerId, environment, context.gaClientId, context.gaSessionId,
        context.first ? JSON.stringify(context.first) : null, context.last ? JSON.stringify(context.last) : null,
        now, now + WINDOW_MS, uid).run();
    return Number(result?.meta?.changes || 0) > 0;
  } catch (_) {
    console.warn('[ATTRIBUTION] checkout context unavailable; payment remains unattributed');
    return false;
  }
}

// Both authenticated and signed-out rejection remove this browser's saved
// contexts. Account-wide rejection additionally removes the user's contexts.
// Future delivery/link rows must reference these contexts with ON DELETE CASCADE.
export async function revokeCheckoutAttribution(env, { userId, clientId }) {
  const db = getDb(env);
  if (!db) return false;
  await db.prepare('DELETE FROM checkout_attributions WHERE user_id = ?1 OR client_id = ?2')
    .bind(userId || null, CLIENT_ID.test(clientId || '') ? clientId : null).run();
  return true;
}
