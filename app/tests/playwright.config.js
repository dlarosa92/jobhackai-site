const { defineConfig, devices } = require('@playwright/test');

const ENVIRONMENTS = {
  dev: 'https://dev.jobhackai.io',
  qa: 'https://qa.jobhackai.io',
};

const ENV = process.env.TEST_ENV || 'dev';
const BASE_URL = ENVIRONMENTS[ENV] || ENVIRONMENTS.dev;

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
        storageState: '.auth/user.json', // Relative to config file location (app/tests/)
      },
    },
  ],
  globalSetup: require.resolve('./fixtures/global-setup.js'),
});

