export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { action, data } = await request.json();

    switch (action) {
      case 'create-checkout-session':
        return await createCheckoutSession(data, env);
      case 'create-customer-portal':
        return await createCustomerPortal(data, env);
      case 'webhook':
        return await handleWebhook(data, env);
      default:
        return new Response('Invalid action', { status: 400 });
    }
  } catch (error) {
    console.error('Stripe error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

async function createCheckoutSession(data, env) {
  const { priceId, userId, userEmail } = data || {};

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[]': 'card',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        mode: 'subscription',
        success_url: `${env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.FRONTEND_URL}/payment-cancelled`,
        customer_email: userEmail,
        'metadata[userId]': userId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Stripe API error: ${errorData}`);
    }

    const session = await response.json();

    return new Response(
      JSON.stringify({ success: true, sessionId: session.id, url: session.url }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function createCustomerPortal(data, env) {
  const { customerId } = data || {};

  try {
    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: customerId,
        return_url: `${env.FRONTEND_URL}/dashboard`,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Stripe API error: ${errorData}`);
    }

    const portalSession = await response.json();

    return new Response(
      JSON.stringify({ success: true, url: portalSession.url }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Stripe portal error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function handleWebhook(data, env) {
  const { type, data: eventData } = data || {};

  console.log('Webhook received:', type);

  switch (type) {
    case 'checkout.session.completed':
      console.log('Checkout completed:', eventData);
      break;
    case 'customer.subscription.created':
      console.log('Subscription created:', eventData);
      break;
    case 'invoice.payment_succeeded':
      console.log('Payment succeeded:', eventData);
      break;
    case 'invoice.payment_failed':
      console.log('Payment failed:', eventData);
      break;
    default:
      console.log('Unhandled webhook type:', type);
  }

  return new Response(
    JSON.stringify({ success: true, message: 'Webhook processed successfully', type }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
