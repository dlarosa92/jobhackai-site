const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const TEST_EMAIL = process.env.TEST_EMAIL || 'jobshackai@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Password1234';
const BASE_URL = process.env.TEST_ENV === 'qa' 
  ? 'https://qa.jobhackai.io'
  : 'https://dev.jobhackai.io';

async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log(`🔐 Authenticating as ${TEST_EMAIL} on ${BASE_URL}`);
    
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

