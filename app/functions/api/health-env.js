import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { hasValidAdminKey } from '../_lib/admin-auth.js';
import { isExplicitNonProductionEnvironment } from '../_lib/debug-access.js';

// Which secrets are configured is operator information. The operator secret
// (X-Admin-Key) works in every environment. A signed-in user is accepted only
// when ENVIRONMENT is explicitly non-production, so an ordinary customer
// account can never map the production configuration.
async function isAllowed(request, env) {
  if (await hasValidAdminKey(request, env)) return true;
  if (!isExplicitNonProductionEnvironment(env)) return false;
  const token = getBearer(request);
  if (!token) return false;
  try {
    await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    return true;
  } catch {
    return false;
  }
}

export async function onRequest({ request, env }) {
  // Require authentication — this endpoint must never be public
  if (!(await isAllowed(request, env))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  const keys = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'FIREBASE_WEB_API_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_ESSENTIAL_MONTHLY',
    'STRIPE_PRICE_PRO_MONTHLY',
    'STRIPE_PRICE_PREMIUM_MONTHLY',
    'FRONTEND_URL',
    'RESEND_API_KEY'
  ];

  // Only report existence — never leak values
  const present = {};
  for (const k of keys) {
    present[k] = { exists: typeof env[k] !== 'undefined' && !!env[k] };
  }

  present['JOBHACKAI_KV'] = { exists: !!env.JOBHACKAI_KV };

  return new Response(JSON.stringify({ present }, null, 2), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

