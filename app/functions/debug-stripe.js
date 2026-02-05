export async function onRequest({ env }) {
  const frontendUrl = env.FRONTEND_URL || 'https://qa.jobhackai.io';
  const successUrl = `${frontendUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${frontendUrl}/payment-cancelled`;
  const returnUrl = `${frontendUrl}/dashboard`;

  return new Response(
    JSON.stringify({
      success: true,
      environment: env.ENVIRONMENT,
      frontendUrl: frontendUrl,
      successUrl: successUrl,
      cancelUrl: cancelUrl,
      returnUrl: returnUrl,
      timestamp: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
