const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// Require credentials from environment variables - no hardcoded fallbacks
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const BASE_URL = process.env.TEST_ENV === 'qa' 
  ? 'https://qa.jobhackai.io'
  : 'https://dev.jobhackai.io';

async function globalSetup() {
  // Fail early if credentials are not provided
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    if (isCI) {
      throw new Error(
        'TEST_EMAIL and TEST_PASSWORD environment variables must be set.\n' +
        'To fix this, add GitHub Secrets:\n' +
        '1. Go to your GitHub repository\n' +
        '2. Navigate to Settings → Secrets and variables → Actions\n' +
        '3. Click "New repository secret"\n' +
        '4. Add TEST_EMAIL with value: jobshackai@gmail.com\n' +
        '5. Add TEST_PASSWORD with value: Password1234\n' +
        '6. Re-run the workflow'
      );
    } else {
      throw new Error(
        'TEST_EMAIL and TEST_PASSWORD environment variables must be set.\n' +
        'Set them in your shell or create a .env file:\n' +
        '  export TEST_EMAIL=your-email@example.com\n' +
        '  export TEST_PASSWORD=your-password\n' +
        'Or run: TEST_EMAIL=email TEST_PASSWORD=password npm run test:e2e:dev'
      );
    }
  }
  
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log(`🔐 Authenticating on ${BASE_URL}`);
    
    await page.goto(`${BASE_URL}/login`);
    
    // Wait for login form - using actual selector from login.html
    await page.waitForSelector('#loginEmail', { timeout: 15000 });
    
    // Fill login form with actual selectors
    await page.fill('#loginEmail', TEST_EMAIL);
    await page.fill('#loginPassword', TEST_PASSWORD);
    
    // Click submit button
    await page.click('#loginContinueBtn');
    
    // Wait for redirect to dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 20000 });
    
    // Ensure auth directory exists
    const authDir = path.join(__dirname, '../.auth');
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    
    // Save auth state
    await context.storageState({ 
      path: path.join(authDir, 'user.json') 
    });
    
    console.log('✅ Authentication successful, state saved');
  } catch (error) {
    console.error('❌ Authentication failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = globalSetup;

