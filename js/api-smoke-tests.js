/**
 * API Smoke Tests for JobHackAI
 * Tests critical API endpoints to ensure they're working properly
 */

class APISmokeTests {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
  }

  async runAllTests() {
    console.log('🧪 Starting API Smoke Tests...');
    
    try {
      await this.testHealthEndpoint();
      await this.testEchoAuthEndpoint();
      await this.testStripeCheckoutEndpoint();
      
      this.generateReport();
    } catch (error) {
      console.error('❌ Smoke tests failed:', error);
      this.results.push({
        name: 'Test Suite',
        status: 'failed',
        error: error.message
      });
    }
  }

  async testHealthEndpoint() {
    const test = { name: 'Health Endpoint', status: 'pending' };
    
    try {
      const response = await fetch('/api/health-env');
      const data = await response.json();
      
      if (response.ok && data.present) {
        test.status = 'passed';
        test.details = `Environment variables: ${Object.keys(data.present).length} available`;
        test.data = {
          hasStripeKey: !!data.present.STRIPE_SECRET_KEY,
          hasFirebaseProject: !!data.present.FIREBASE_PROJECT_ID,
          hasKv: !!data.present.JOBHACKAI_KV,
          hasPrices: {
            essential: !!data.present.STRIPE_PRICE_ESSENTIAL_MONTHLY,
            pro: !!data.present.STRIPE_PRICE_PRO_MONTHLY,
            premium: !!data.present.STRIPE_PRICE_PREMIUM_MONTHLY
          }
        };
      } else {
        test.status = 'failed';
        test.error = `HTTP ${response.status}: ${data.error || 'Unknown error'}`;
      }
    } catch (error) {
      test.status = 'failed';
      test.error = error.message;
    }
    
    this.results.push(test);
  }

  async testEchoAuthEndpoint() {
    const test = { name: 'Echo Auth Endpoint', status: 'pending' };
    
    try {
      const response = await fetch('/api/echo-auth', {
        headers: { 'Authorization': 'Bearer invalid-token' }
      });
      const data = await response.json();
      
      if (response.status === 401 && data.error === 'Invalid Compact JWS') {
        test.status = 'passed';
        test.details = 'Properly rejects invalid tokens';
      } else {
        test.status = 'failed';
        test.error = `Unexpected response: ${response.status} - ${JSON.stringify(data)}`;
      }
    } catch (error) {
      test.status = 'failed';
      test.error = error.message;
    }
    
    this.results.push(test);
  }

  async testStripeCheckoutEndpoint() {
    const test = { name: 'Stripe Checkout Endpoint', status: 'pending' };
    
    try {
      const response = await fetch('/api/stripe-checkout', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token'
        },
        body: JSON.stringify({ plan: 'trial', startTrial: true })
      });
      const data = await response.json();
      
      if (response.status === 401 && data.error === 'Invalid authentication token') {
        test.status = 'passed';
        test.details = 'Properly rejects invalid tokens and returns JSON';
      } else if (response.status === 401 && data.error === 'unauthorized') {
        test.status = 'passed';
        test.details = 'Properly rejects requests without valid auth';
      } else {
        test.status = 'failed';
        test.error = `Unexpected response: ${response.status} - ${JSON.stringify(data)}`;
      }
    } catch (error) {
      test.status = 'failed';
      test.error = error.message;
    }
    
    this.results.push(test);
  }

  generateReport() {
    const duration = Date.now() - this.startTime;
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    const total = this.results.length;
    
    console.log('\n🧪 API Smoke Test Results:');
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${failed}/${total}`);
    console.log(`📊 Success Rate: ${((passed/total) * 100).toFixed(1)}%`);
    
    this.results.forEach(result => {
      const icon = result.status === 'passed' ? '✅' : '❌';
      console.log(`${icon} ${result.name}: ${result.status}`);
      if (result.details) console.log(`   ${result.details}`);
      if (result.error) console.log(`   Error: ${result.error}`);
      if (result.data) console.log(`   Data:`, result.data);
    });
    
    // Store results for debugging
    if (typeof window !== 'undefined') {
      window.apiSmokeTestResults = {
        timestamp: new Date().toISOString(),
        duration,
        total,
        passed,
        failed,
        results: this.results
      };
    }
    
    return { passed, failed, total, results: this.results };
  }
}

// Auto-run tests if this script is loaded
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const tests = new APISmokeTests();
    tests.runAllTests();
  });
}

// Export for manual testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = APISmokeTests;
}
