/**
 * Helper script to sync plan from Stripe to KV store
 * This can be run manually or as part of test setup
 * 
 * Usage:
 *   node sync-plan.js <test-email> <test-password> <base-url>
 * 
 * Example:
 *   node sync-plan.js jobshackai@gmail.com password123 https://dev.jobhackai.io
 */

const { chromium } = require('playwright');

async function syncPlan(email, password, baseURL) {
  console.log(`🔄 Syncing plan for ${email} on ${baseURL}...`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  
  try {
    console.log(`🔐 Authenticating on ${baseURL}`);
    
    // Navigate to login page
    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    
    // Wait for login form - using actual selector from login.html
    await page.waitForSelector('#loginEmail', { timeout: 15000 });
    
    // Wait for Firebase and authManager to be ready
    await page.waitForFunction(() => {
      return window.FirebaseAuthManager !== undefined && 
             typeof window.FirebaseAuthManager.signIn === 'function';
    }, { timeout: 15000 });
    
    // Use FirebaseAuthManager.signIn directly (same as global-setup.js)
    let loginResult;
    let navigationAlreadyHandled = false;
    
    try {
      loginResult = await page.evaluate(async ({ email, password }) => {
        if (!window.FirebaseAuthManager || typeof window.FirebaseAuthManager.signIn !== 'function') {
          return { success: false, error: 'FirebaseAuthManager.signIn not available' };
        }
        
        try {
          const result = await window.FirebaseAuthManager.signIn(email, password);
          return result;
        } catch (error) {
          return { success: false, error: error.message || 'Login failed' };
        }
      }, { email, password });
    } catch (evaluateError) {
      // If execution context was destroyed due to navigation, check if we navigated successfully
      if (evaluateError.message.includes('Execution context was destroyed')) {
        try {
          await page.waitForURL(/\/dashboard|\/verify-email/, { timeout: 10000 });
          const currentURL = page.url();
          if (currentURL.includes('/dashboard') || currentURL.includes('/verify-email')) {
            console.log('✅ Login succeeded (detected via navigation)');
            loginResult = { success: true };
            navigationAlreadyHandled = true;
          }
        } catch (navError) {
          const currentURL = page.url();
          throw new Error(`Login failed: Execution context destroyed but no successful navigation. Current URL: ${currentURL}`);
        }
      } else {
        throw evaluateError;
      }
    }
    
    // Wait for navigation if it hasn't happened yet
    if (!navigationAlreadyHandled) {
      try {
        await page.waitForURL(/\/dashboard|\/verify-email/, { timeout: 30000 });
        const currentURL = page.url();
        if (currentURL.includes('/dashboard')) {
          console.log('✅ Login successful, navigated to dashboard');
        } else if (currentURL.includes('/verify-email')) {
          console.log('⚠️ Login successful but email verification required');
        }
      } catch (navError) {
        const currentURL = page.url();
        throw new Error(`Login navigation timeout. Current URL: ${currentURL}`);
      }
    }
    
    if (loginResult && !loginResult.success) {
      throw new Error(`Login failed: ${loginResult.error || 'Unknown error'}`);
    }
    
    // Wait for auth to be ready
    await page.waitForFunction(() => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      return user !== null && user !== undefined;
    }, { timeout: 10000 });
    
    // Get auth token
    const token = await page.evaluate(async () => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      if (user) {
        return await user.getIdToken();
      }
      return null;
    });
    
    if (!token) {
      throw new Error('Failed to get auth token');
    }
    
    // Check current plan
    console.log('🔍 Checking current plan...');
    const planResponse = await page.request.get('/api/plan/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (planResponse.ok()) {
      const planData = await planResponse.json();
      console.log('📊 Current plan in KV:', JSON.stringify(planData, null, 2));
    }
    
    // Sync plan from Stripe
    console.log('🔄 Syncing plan from Stripe...');
    const syncResponse = await page.request.post('/api/sync-stripe-plan', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Origin': baseURL,
      },
      data: {}
    });
    
    const syncData = await syncResponse.json();
    console.log('📊 Sync response:', JSON.stringify(syncData, null, 2));
    
    if (syncResponse.ok() && syncData.ok) {
      console.log(`✅ Plan synced successfully: ${syncData.plan}`);
    } else {
      console.error('❌ Sync failed:', syncData.error || 'Unknown error');
    }
    
    // Verify plan after sync (with retries for eventual consistency)
    console.log('🔍 Verifying plan after sync...');
    let verifyData = null;
    let retries = 3;
    
    for (let i = 0; i < retries; i++) {
      if (i > 0) {
        console.log(`⏳ Waiting 2 seconds before retry ${i + 1}/${retries}...`);
        await page.waitForTimeout(2000);
      }
      
      const verifyResponse = await page.request.get('/api/plan/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (verifyResponse.ok()) {
        verifyData = await verifyResponse.json();
        console.log(`📊 Plan in KV after sync (attempt ${i + 1}):`, JSON.stringify(verifyData, null, 2));
        
        if (verifyData.plan === 'essential' || verifyData.plan === 'Essential') {
          console.log('✅ Plan is correctly set to Essential in KV');
          break;
        } else if (i < retries - 1) {
          console.warn(`⚠️ Plan is still ${verifyData.plan}, retrying...`);
        } else {
          console.warn(`⚠️ Plan is ${verifyData.plan}, expected Essential after ${retries} attempts`);
        }
      }
    }
    
    // Get UID for debugging
    const uid = await page.evaluate(() => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      return user?.uid || null;
    });
    console.log('🔍 User UID:', uid);
    console.log('🔍 KV key should be: planByUid:' + uid);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Try to get from environment variables if not provided as args
  const email = args[0] || process.env.TEST_EMAIL;
  const password = args[1] || process.env.TEST_PASSWORD;
  const baseURL = args[2] || (process.env.TEST_ENV === 'qa' 
    ? 'https://qa.jobhackai.io' 
    : 'https://dev.jobhackai.io');
  
  if (!email || !password) {
    console.error('Usage: node sync-plan.js [email] [password] [base-url]');
    console.error('Or set environment variables: TEST_EMAIL, TEST_PASSWORD, TEST_ENV');
    console.error('Example: node sync-plan.js jobshackai@gmail.com password123 https://dev.jobhackai.io');
    console.error('Or: TEST_EMAIL=jobshackai@gmail.com TEST_PASSWORD=password123 node sync-plan.js');
    process.exit(1);
  }
  
  syncPlan(email, password, baseURL)
    .then(() => {
      console.log('✅ Sync complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Sync failed:', error);
      process.exit(1);
    });
}

module.exports = { syncPlan };

