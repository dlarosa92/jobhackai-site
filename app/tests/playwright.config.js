const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// Load .env.test.local and .env from app/ so TEST_ENV etc. are available
const appDir = path.join(__dirname, '..');
function loadEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  } catch (_) {}
}
loadEnvFile(path.join(appDir, '.env'));
loadEnvFile(path.join(appDir, '.env.test.local'));

const ENVIRONMENTS = {
  dev: 'https://dev.jobhackai.io',
  qa: 'https://qa.jobhackai.io',
  prod: 'https://app.jobhackai.io',
};

const ENV = process.env.TEST_ENV || 'dev';
const BASE_URL = ENVIRONMENTS[ENV] || ENVIRONMENTS.dev;

// Resolve storageState path relative to config file location
// Config file is at app/tests/playwright.config.js
// Auth state is saved to app/tests/.auth/user.json by global setup
const storageStatePath = path.join(__dirname, '.auth', 'user.json');

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Firebase auth doesn't like parallel
  reporter: [
    ['html'],
    ['list']
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        storageState: storageStatePath, // Absolute path: app/tests/.auth/user.json
      },
    },
  ],
  globalSetup: require.resolve('./fixtures/global-setup.js'),
});
