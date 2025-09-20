import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, data } = req.body;
    
    switch (action) {
      case 'create-checkout-session':
        return await createCheckoutSession(data, res);
      case 'create-customer-portal':
        return await createCustomerPortal(data, res);
      case 'webhook':
        return await handleWebhook(data, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error: any) {
    console.error('Stripe error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createCheckoutSession(data: any, res: NextApiResponse) {
  const { priceId, userId, userEmail } = data;
  
  try {
    // For local development, return a mock response
    // In production, this would call the actual Stripe API
    const mockSession = {
      success: true,
      sessionId: 'cs_test_mock_' + Date.now(),
      url: 'https://checkout.stripe.com/pay/cs_test_mock_' + Date.now()
    };

    return res.status(200).json(mockSession);
  } catch (error: any) {
    console.error('Stripe checkout error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
}

async function createCustomerPortal(data: any, res: NextApiResponse) {
  const { customerId } = data;
  
  try {
    // For local development, return a mock response
    const mockPortal = {
      success: true,
      url: 'https://billing.stripe.com/p/session/mock_' + Date.now()
    };

    return res.status(200).json(mockPortal);
  } catch (error: any) {
    console.error('Stripe portal error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
}

async function handleWebhook(data: any, res: NextApiResponse) {
  const { type, data: eventData } = data;
  
  console.log('Webhook received:', type);
  
  // Handle different webhook events
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
  
  return res.status(200).json({ 
    success: true, 
    message: 'Webhook processed successfully',
    type: type
  });
}
