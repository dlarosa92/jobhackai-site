// Cloudflare Worker for Stripe integration
export async function onRequest(context: any) {
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

async function createCheckoutSession(data: any, env: any) {
  const { priceId, userId, userEmail } = data;
  
  const stripe = require('stripe')(env.STRIPE_SECRET_KEY);
  
  const session = await stripe.checkout.sessions.create({
    customer_email: userEmail,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: `${env.FRONTEND_URL}/dashboard?success=true`,
    cancel_url: `${env.FRONTEND_URL}/pricing?canceled=true`,
    metadata: {
      userId: userId,
    },
  });

  return new Response(JSON.stringify({ sessionId: session.id }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function createCustomerPortal(data: any, env: any) {
  const { customerId } = data;
  
  const stripe = require('stripe')(env.STRIPE_SECRET_KEY);
  
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${env.FRONTEND_URL}/dashboard`,
  });

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleWebhook(data: any, env: any) {
  const { type, data: eventData } = data;
  
  switch (type) {
    case 'customer.subscription.created':
      await handleSubscriptionCreated(eventData, env);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(eventData, env);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(eventData, env);
      break;
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(eventData, env);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailed(eventData, env);
      break;
  }

  return new Response('OK', { status: 200 });
}

async function handleSubscriptionCreated(data: any, env: any) {
  const { object: subscription } = data;
  const userId = subscription.metadata.userId;
  
  if (userId) {
    await env.JOBHACKAI_KV.put(
      `subscription:${userId}`,
      JSON.stringify({
        subscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        planId: subscription.items.data[0].price.id,
      })
    );
  }
}

async function handleSubscriptionUpdated(data: any, env: any) {
  const { object: subscription } = data;
  const userId = subscription.metadata.userId;
  
  if (userId) {
    await env.JOBHACKAI_KV.put(
      `subscription:${userId}`,
      JSON.stringify({
        subscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        planId: subscription.items.data[0].price.id,
      })
    );
  }
}

async function handleSubscriptionDeleted(data: any, env: any) {
  const { object: subscription } = data;
  const userId = subscription.metadata.userId;
  
  if (userId) {
    await env.JOBHACKAI_KV.delete(`subscription:${userId}`);
  }
}

async function handlePaymentSucceeded(data: any, env: any) {
  // Handle successful payment
  console.log('Payment succeeded:', data.object.id);
}

async function handlePaymentFailed(data: any, env: any) {
  // Handle failed payment
  console.log('Payment failed:', data.object.id);
}
