import { isExplicitNonProductionEnvironment, notFoundInProductionResponse } from './_lib/debug-access.js';

export async function onRequest({ env }) {
  if (!isExplicitNonProductionEnvironment(env)) {
    return notFoundInProductionResponse();
  }

  const stripeSecretKey = env.STRIPE_SECRET_KEY || 'NOT_SET';
  const stripeKeyType = stripeSecretKey.startsWith('sk_test_') ? 'TEST' : (stripeSecretKey.startsWith('sk_live_') ? 'LIVE' : 'UNKNOWN');

  return new Response(
    JSON.stringify({
      success: true,
      environment: env.ENVIRONMENT,
      stripeKeyType,
      timestamp: new Date().toISOString(),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    }
  );
}
