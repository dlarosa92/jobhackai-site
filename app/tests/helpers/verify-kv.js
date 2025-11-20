/**
 * Diagnostic script to verify KV store contents
 * This helps debug why plan sync isn't persisting
 */

const { chromium } = require('playwright');

async function verifyKV(email, password, baseURL) {
  console.log(`🔍 Verifying KV for ${email} on ${baseURL}...`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  
  try {
    console.log(`🔐 Authenticating on ${baseURL}`);
    
    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loginEmail', { timeout: 15000 });
    await page.waitForFunction(() => {
      return window.FirebaseAuthManager !== undefined && 
             typeof window.FirebaseAuthManager.signIn === 'function';
    }, { timeout: 15000 });
    
    // Login
    let loginResult;
    try {
      loginResult = await page.evaluate(async ({ email, password }) => {
        return await window.FirebaseAuthManager.signIn(email, password);
      }, { email, password });
    } catch (evaluateError) {
      if (evaluateError.message.includes('Execution context was destroyed')) {
        await page.waitForURL(/\/dashboard|\/verify-email/, { timeout: 10000 });
        loginResult = { success: true };
      } else {
        throw evaluateError;
      }
    }
    
    if (!loginResult || !loginResult.success) {
      await page.waitForURL(/\/dashboard|\/verify-email/, { timeout: 30000 });
    }
    
    // Get auth token and UID
    const { token, uid } = await page.evaluate(async () => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      if (user) {
        return {
          token: await user.getIdToken(),
          uid: user.uid
        };
      }
      return { token: null, uid: null };
    });
    
    if (!token || !uid) {
      throw new Error('Failed to get auth token or UID');
    }
    
    console.log('✅ Authenticated');
    console.log('🔍 User UID:', uid);
    console.log('🔍 KV key should be: planByUid:' + uid);
    
    // Check plan from API
    console.log('\n📊 Checking /api/plan/me...');
    const planResponse = await page.request.get('/api/plan/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (planResponse.ok()) {
      const planData = await planResponse.json();
      console.log('Plan from KV:', JSON.stringify(planData, null, 2));
    } else {
      console.error('❌ Plan API failed:', planResponse.status());
    }
    
    // Check customer ID in KV
    console.log('\n📊 Checking customer ID...');
    const customerResponse = await page.request.get('/api/billing-status', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (customerResponse.ok()) {
      const customerData = await customerResponse.json();
      console.log('Customer data:', JSON.stringify(customerData, null, 2));
    }
    
    // Try to sync again and immediately check
    console.log('\n🔄 Syncing plan...');
    const syncResponse = await page.request.post('/api/sync-stripe-plan', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Origin': baseURL,
      },
      data: {}
    });
    
    const syncData = await syncResponse.json();
    console.log('Sync response:', JSON.stringify(syncData, null, 2));
    
    // Wait a moment
    await page.waitForTimeout(1000);
    
    // Check plan again immediately
    console.log('\n📊 Checking plan again after sync...');
    const planResponse2 = await page.request.get('/api/plan/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (planResponse2.ok()) {
      const planData2 = await planResponse2.json();
      console.log('Plan from KV after sync:', JSON.stringify(planData2, null, 2));
      
      if (planData2.plan === 'free' && syncData.plan === 'essential') {
        console.error('\n❌ ISSUE DETECTED: Sync returned "essential" but KV still shows "free"');
        console.error('This indicates:');
        console.error('1. KV write is failing silently');
        console.error('2. Different KV namespaces (dev vs production)');
        console.error('3. Something is overwriting the plan immediately');
        console.error('4. KV eventual consistency issue (unlikely after 1 second)');
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
  const email = args[0] || process.env.TEST_EMAIL;
  const password = args[1] || process.env.TEST_PASSWORD;
  const baseURL = args[2] || (process.env.TEST_ENV === 'qa' 
    ? 'https://qa.jobhackai.io' 
    : 'https://dev.jobhackai.io');
  
  if (!email || !password) {
    console.error('Usage: node verify-kv.js [email] [password] [base-url]');
    process.exit(1);
  }
  
  verifyKV(email, password, baseURL)
    .then(() => {
      console.log('\n✅ Verification complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Verification failed:', error);
      process.exit(1);
    });
}

module.exports = { verifyKV };

