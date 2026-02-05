import React, { useState } from 'react';

export default function SimpleTest() {
  const [result, setResult] = useState<string>('');

  const testStripe = async () => {
    try {
      // Simulate Stripe API call
      const mockResponse = {
        success: true,
        sessionId: 'cs_test_mock_' + Date.now(),
        url: 'https://checkout.stripe.com/pay/cs_test_mock_' + Date.now()
      };
      
      setResult(JSON.stringify(mockResponse, null, 2));
    } catch (error: any) {
      setResult(`Error: ${error.message}`);
    }
  };

  const testAuth = async () => {
    try {
      // Simulate Auth API call
      const mockResponse = {
        success: true,
        user: {
          uid: 'mock_user_' + Date.now(),
          email: 'test@example.com',
          emailVerified: true
        }
      };
      
      setResult(JSON.stringify(mockResponse, null, 2));
    } catch (error: any) {
      setResult(`Error: ${error.message}`);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui' }}>
      <h1>Simple Integration Test</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={testStripe}
          style={{ 
            padding: '10px 20px', 
            marginRight: '10px', 
            backgroundColor: '#1976d2', 
            color: 'white', 
            border: 'none', 
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          Test Stripe (Mock)
        </button>
        
        <button 
          onClick={testAuth}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: '#4caf50', 
            color: 'white', 
            border: 'none', 
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          Test Auth (Mock)
        </button>
      </div>

      {result && (
        <div style={{ 
          marginTop: '20px', 
          padding: '15px', 
          backgroundColor: '#f5f5f5', 
          borderRadius: '8px',
          border: '1px solid #ddd'
        }}>
          <h3>Result:</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '14px' }}>
            {result}
          </pre>
        </div>
      )}

      <div style={{ marginTop: '30px', padding: '15px', backgroundColor: '#e3f2fd', borderRadius: '8px' }}>
        <h3>Test Instructions:</h3>
        <ol>
          <li>Click "Test Stripe (Mock)" to simulate a Stripe checkout session</li>
          <li>Click "Test Auth (Mock)" to simulate Firebase authentication</li>
          <li>Check the result to see if the mock responses work</li>
          <li>If this works, the issue is with the API routes configuration</li>
        </ol>
      </div>
    </div>
  );
}
