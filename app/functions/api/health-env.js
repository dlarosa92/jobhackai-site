export async function onRequest({ request, env }) {
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
    'JOBHACKAI_KV'
  ];

  const present = {};
  for (const k of keys) {
    present[k] = typeof env[k] !== 'undefined';
  }

  // KV binding presence check
  present['JOBHACKAI_KV'] = !!env.JOBHACKAI_KV;

  return new Response(JSON.stringify({ present }, null, 2), {
    headers: { 
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

