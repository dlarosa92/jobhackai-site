export async function onRequest({ env }) {
  const hasFirebaseApiKey = !!env.FIREBASE_API_KEY;
  const hasStripePublishableKey = !!env.STRIPE_PUBLISHABLE_KEY;
  const hasStripeSecretKey = !!env.STRIPE_SECRET_KEY;
  const hasFrontendUrl = !!env.FRONTEND_URL;

  return new Response(
    JSON.stringify({
      success: true,
      environment: env.ENVIRONMENT,
      hasFirebaseApiKey,
      hasStripePublishableKey,
      hasStripeSecretKey,
      hasFrontendUrl,
      frontendUrl: env.FRONTEND_URL || 'NOT_SET',
      timestamp: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
