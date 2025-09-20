export async function onRequest({ env }) {
  const hasFirebaseApiKey = !!env.FIREBASE_API_KEY;
  const hasStripePublishableKey = !!env.STRIPE_PUBLISHABLE_KEY;
  const hasStripeSecretKey = !!env.STRIPE_SECRET_KEY;

  return new Response(
    JSON.stringify({
      success: true,
      environment: env.ENVIRONMENT,
      hasFirebaseApiKey,
      hasStripePublishableKey,
      hasStripeSecretKey,
      timestamp: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
