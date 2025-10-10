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
    present[k] = {
      exists: typeof env[k] !== 'undefined',
      value: env[k] ? `${env[k].toString().substring(0, 20)}...` : env[k]
    };
  }

  // KV binding presence check
  present['JOBHACKAI_KV'] = {
    exists: !!env.JOBHACKAI_KV,
    value: env.JOBHACKAI_KV ? 'KV binding available' : 'KV binding not available'
  };

  return new Response(JSON.stringify({ present }, null, 2), {
    headers: { 
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

