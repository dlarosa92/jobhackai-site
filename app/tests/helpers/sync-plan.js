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
    // Navigate to login page
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for Firebase auth to be ready
    await page.waitForFunction(() => {
      return window.FirebaseAuthManager !== undefined && 
             typeof window.FirebaseAuthManager.getCurrentUser === 'function';
    }, { timeout: 10000 });
    
    // Login
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('#loginContinueBtn');
    
    // Wait for dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 20000 });
    console.log('✅ Login successful');
    
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
    
    // Verify plan after sync
    console.log('🔍 Verifying plan after sync...');
    const verifyResponse = await page.request.get('/api/plan/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (verifyResponse.ok()) {
      const verifyData = await verifyResponse.json();
      console.log('📊 Plan in KV after sync:', JSON.stringify(verifyData, null, 2));
      
      if (verifyData.plan === 'essential' || verifyData.plan === 'Essential') {
        console.log('✅ Plan is correctly set to Essential in KV');
      } else {
        console.warn(`⚠️ Plan is ${verifyData.plan}, expected Essential`);
      }
    }
    
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
  if (args.length < 3) {
    console.error('Usage: node sync-plan.js <email> <password> <base-url>');
    console.error('Example: node sync-plan.js jobshackai@gmail.com password123 https://dev.jobhackai.io');
    process.exit(1);
  }
  
  const [email, password, baseURL] = args;
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

