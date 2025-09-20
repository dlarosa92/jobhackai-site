import React, { useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export default function StripeTest() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [apiResponse, setApiResponse] = useState<any>(null);

  // JobHackAI Pricing Tiers (Test Mode)
  const pricingPlans = [
    {
      id: 'essential',
      name: 'Essential',
      price: '$29',
      period: '/month',
      description: 'Perfect for job seekers getting started',
      features: [
        'Unlimited ATS Resume Scoring',
        'Resume Feedback & Optimization',
        'Interview Question Generator',
        'Email Support'
      ],
      priceId: 'price_1S4MsxApMPhcB1Y6sC4oQzNL', // Essential Plan
      stripePriceId: 'price_1S4MsxApMPhcB1Y6sC4oQzNL'
    },
    {
      id: 'pro',
      name: 'Pro',
      price: '$59',
      period: '/month',
      description: 'For serious job seekers',
      features: [
        'Everything in Essential',
        'Resume Rewrite Service',
        'Cover Letter Generator',
        'Mock Interview Practice',
        'Priority Support'
      ],
      priceId: 'price_1S4MwlApMPhcB1Y6ejrHX2g9', // Pro Plan
      stripePriceId: 'price_1S4MwlApMPhcB1Y6ejrHX2g9'
    },
    {
      id: 'premium',
      name: 'Premium',
      price: '$99',
      period: '/month',
      description: 'Complete career optimization',
      features: [
        'Everything in Pro',
        'LinkedIn Profile Optimizer',
        'Priority Review (24hrs)',
        'Career Coaching Session',
        'Phone Support'
      ],
      priceId: 'price_1S4MykApMPhcB1Y6g4OStoSy', // Premium Plan
      stripePriceId: 'price_1S4MykApMPhcB1Y6g4OStoSy'
    }
  ];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });

    return () => unsubscribe();
  }, []);

  const createCheckoutSession = async (priceId: string, planName: string) => {
    if (!user) {
      setError('Please sign in first');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      // Use the Cloudflare Pages Function endpoint
      const response = await fetch('/api/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'create-checkout-session',
          data: {
            priceId: priceId,
            userId: user.uid,
            userEmail: user.email,
            planName: planName
          }
        }),
      });

      const data = await response.json();
      console.log('Checkout session response:', data);
      setApiResponse(data);

      if (data.success && data.url) {
        setSuccess(`Redirecting to Stripe checkout for ${planName}...`);
        // Redirect to Stripe checkout
        window.location.href = data.url;
      } else {
        setError(`Checkout failed: ${data.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      setError(`Checkout failed: ${error.message}`);
      console.error('Checkout error:', error);
    } finally {
      setLoading(false);
    }
  };

  const testCustomerPortal = async () => {
    if (!user) {
      setError('Please sign in first');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      const response = await fetch('/api/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'create-customer-portal',
          data: {
            customerId: 'cus_test123', // This would be a real customer ID
            userId: user.uid
          }
        }),
      });

      const data = await response.json();
      console.log('Customer portal response:', data);
      setApiResponse(data);

      if (data.success && data.url) {
        setSuccess('Redirecting to customer portal...');
        window.open(data.url, '_blank');
      } else {
        setError(`Customer portal failed: ${data.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      setError(`Customer portal failed: ${error.message}`);
      console.error('Customer portal error:', error);
    } finally {
      setLoading(false);
    }
  };

  const testWebhook = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await fetch('/api/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'webhook',
          data: {
            type: 'checkout.session.completed',
            data: {
              object: {
                id: 'cs_test_123',
                customer: 'cus_test123',
                amount_total: 2900,
                currency: 'usd'
              }
            }
          }
        }),
      });

      const data = await response.json();
      console.log('Webhook test response:', data);
      setApiResponse(data);
      setSuccess('Webhook test completed successfully!');
    } catch (error: any) {
      setError(`Webhook test failed: ${error.message}`);
      console.error('Webhook test error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui' }}>
      <h1>Stripe Payment Integration Test</h1>
      
      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
        <h2>Current Status</h2>
        {user ? (
          <div>
            <p><strong>✅ Authenticated User</strong></p>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>UID:</strong> {user.uid}</p>
          </div>
        ) : (
          <p><strong>❌ Not Authenticated</strong> - Please sign in to test payments</p>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#ffebee', color: '#c62828', borderRadius: '8px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {success && (
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#e8f5e8', color: '#2e7d32', borderRadius: '8px' }}>
          <strong>Success:</strong> {success}
        </div>
      )}

      <div style={{ marginBottom: '30px' }}>
        <h2>JobHackAI Pricing Plans (Test Mode)</h2>
        {!user && (
          <div style={{ 
            padding: '15px', 
            backgroundColor: '#fff3e0', 
            color: '#f57c00', 
            borderRadius: '8px', 
            marginBottom: '20px',
            border: '1px solid #ffb74d'
          }}>
            <strong>⚠️ Authentication Required:</strong> Please sign in first using the 
            <a href="/auth-test" style={{ color: '#1976d2', textDecoration: 'underline', marginLeft: '5px' }}>
              Firebase Auth Test page
            </a> to test payment functionality.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          {pricingPlans.map((plan) => (
            <div key={plan.id} style={{ border: '1px solid #ddd', borderRadius: '12px', padding: '20px', backgroundColor: 'white' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '24px' }}>{plan.name}</h3>
              <div style={{ marginBottom: '15px' }}>
                <span style={{ fontSize: '36px', fontWeight: 'bold', color: '#1976d2' }}>{plan.price}</span>
                <span style={{ color: '#666' }}>{plan.period}</span>
              </div>
              <p style={{ color: '#666', marginBottom: '20px' }}>{plan.description}</p>
              <ul style={{ listStyle: 'none', padding: 0, marginBottom: '25px' }}>
                {plan.features.map((feature, index) => (
                  <li key={index} style={{ padding: '5px 0', display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: '#4caf50', marginRight: '8px' }}>✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => createCheckoutSession(plan.stripePriceId, plan.name)}
                disabled={loading || !user}
                style={{
                  width: '100%',
                  padding: '12px 24px',
                  backgroundColor: user ? '#1976d2' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: user && !loading ? 'pointer' : 'not-allowed',
                  fontSize: '16px',
                  fontWeight: 'bold'
                }}
              >
                {loading ? 'Processing...' : `Subscribe to ${plan.name}`}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h2>Additional Stripe Tests</h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px' }}>
          <button
            onClick={testCustomerPortal}
            disabled={loading || !user}
            style={{
              padding: '12px 24px',
              backgroundColor: user ? '#4caf50' : '#ccc',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: user && !loading ? 'pointer' : 'not-allowed',
              fontSize: '16px'
            }}
          >
            {loading ? 'Loading...' : 'Test Customer Portal'}
          </button>

          <button
            onClick={testWebhook}
            disabled={loading}
            style={{
              padding: '12px 24px',
              backgroundColor: '#ff9800',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '16px'
            }}
          >
            {loading ? 'Testing...' : 'Test Webhook Handler'}
          </button>
        </div>
      </div>

      {apiResponse && (
        <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>API Response</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '14px', overflow: 'auto' }}>
            {JSON.stringify(apiResponse, null, 2)}
          </pre>
        </div>
      )}

      <div style={{ marginTop: '40px', padding: '15px', backgroundColor: '#e3f2fd', borderRadius: '8px' }}>
        <h3>Test Instructions</h3>
        <ol style={{ fontSize: '14px', lineHeight: '1.6' }}>
          <li><strong>Sign in first</strong> - Use the auth-test page to authenticate</li>
          <li><strong>Test Checkout</strong> - Click any plan button to create a Stripe checkout session</li>
          <li><strong>Use Test Cards</strong> - In Stripe checkout, use test card numbers:
            <ul style={{ marginTop: '5px' }}>
              <li><strong>Success:</strong> 4242 4242 4242 4242</li>
              <li><strong>Decline:</strong> 4000 0000 0000 0002</li>
              <li><strong>3D Secure:</strong> 4000 0025 0000 3155</li>
            </ul>
          </li>
          <li><strong>Test Customer Portal</strong> - Test the billing management portal</li>
          <li><strong>Check Console</strong> - Monitor network requests and API responses</li>
        </ol>
      </div>

      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff3e0', borderRadius: '8px' }}>
        <h3>Important Notes</h3>
        <ul style={{ fontSize: '14px', lineHeight: '1.6' }}>
          <li><strong>Test Mode:</strong> All payments are in Stripe test mode - no real charges</li>
          <li><strong>Price IDs:</strong> Current price IDs are placeholders - replace with real Stripe price IDs</li>
          <li><strong>Webhooks:</strong> Set up webhook endpoints in Stripe Dashboard for production</li>
          <li><strong>Customer Portal:</strong> Requires billing portal to be enabled in Stripe Dashboard</li>
        </ul>
      </div>
    </div>
  );
}
