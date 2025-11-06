import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin, env) });
  }

  try {
    const { action, data } = await request.json();

    switch (action) {
      case 'create-checkout-session':
        return await createCheckoutSession(data, request, env, origin);
      case 'create-customer-portal':
        return await createCustomerPortal(data, request, env, origin);
      case 'webhook':
        // Webhooks don't require Firebase auth - they're called by Stripe
        return await handleWebhook(data, env);
      default:
        return json({ success: false, error: 'Invalid action' }, 400, origin, env);
    }
  } catch (error) {
    console.error('Stripe error:', error);
    return json({ success: false, error: 'Internal server error' }, 500, origin, env);
  }
}

async function createCheckoutSession(data, request, env, origin) {
  // Require Firebase authentication
  const token = getBearer(request);
  if (!token) {
    return json({ success: false, error: 'Unauthorized - missing authentication token' }, 401, origin, env);
  }

  try {
    // Verify Firebase ID token and get authenticated user info
    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const userEmail = payload?.email || '';
    
    if (!userEmail) {
      return json({ success: false, error: 'Missing email in authentication token' }, 400, origin, env);
    }

    // Use authenticated user's data - don't trust request body
    const { priceId } = data || {};
    
    if (!priceId) {
      return json({ success: false, error: 'Missing priceId' }, 400, origin, env);
    }

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
        success_url: `${env.FRONTEND_URL || 'https://qa.jobhackai.io'}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.FRONTEND_URL || 'https://qa.jobhackai.io'}/payment-cancelled`,
        customer_email: userEmail, // Use authenticated email
        'metadata[userId]': uid, // Use authenticated uid
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Stripe API error: ${errorData}`);
    }

    const session = await response.json();

    return json(
      { success: true, sessionId: session.id, url: session.url },
      200,
      origin,
      env
    );
  } catch (error) {
    console.error('Stripe checkout error:', error);
    
    // Handle authentication errors
    if (error.message && (error.message.includes('missing uid') || error.message.includes('token'))) {
      return json({ success: false, error: 'Invalid or expired authentication token' }, 401, origin, env);
    }
    
    return json(
      { success: false, error: error.message || 'Failed to create checkout session' },
      500,
      origin,
      env
    );
  }
}

async function createCustomerPortal(data, request, env, origin) {
  // Require Firebase authentication
  const token = getBearer(request);
  if (!token) {
    return json({ success: false, error: 'Unauthorized - missing authentication token' }, 401, origin, env);
  }

  try {
    // Verify Firebase ID token and get authenticated user info
    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);

    // Look up customer ID from authenticated user's uid (don't trust request body)
    const customerId = await env.JOBHACKAI_KV?.get(`cusByUid:${uid}`);
    
    if (!customerId) {
      return json({ success: false, error: 'No customer found for authenticated user' }, 404, origin, env);
    }

    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: customerId, // Use customer ID from authenticated user
        return_url: `${env.FRONTEND_URL || 'https://qa.jobhackai.io'}/dashboard`,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Stripe API error: ${errorData}`);
    }

    const portalSession = await response.json();

    return json(
      { success: true, url: portalSession.url },
      200,
      origin,
      env
    );
  } catch (error) {
    console.error('Stripe portal error:', error);
    
    // Handle authentication errors
    if (error.message && (error.message.includes('missing uid') || error.message.includes('token'))) {
      return json({ success: false, error: 'Invalid or expired authentication token' }, 401, origin, env);
    }
    
    return json(
      { success: false, error: error.message || 'Failed to create customer portal session' },
      500,
      origin,
      env
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

// Helper functions for CORS and JSON responses
function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io'];
  const configured = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || 'https://dev.jobhackai.io');
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };
}

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, env)
  });
}
