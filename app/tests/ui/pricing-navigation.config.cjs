const { defineConfig, devices } = require('@playwright/test');
const path = require('node:path');

const appDir = path.resolve(__dirname, '../..');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'pricing-navigation.spec.cjs',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/jha-pricing-navigation-test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4178',
    storageState: undefined,
    serviceWorkers: 'block',
    launchOptions: {
      channel: 'chromium',
      // Playwright disables BFCache by default. Keep it enabled so these tests
      // exercise the browser restore path that caused the stuck CTA.
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      args: ['--enable-features=BackForwardCache']
    }
  },
  webServer: {
    command: 'node tests/ui/pricing-navigation-server.cjs',
    cwd: appDir,
    url: 'http://127.0.0.1:4178/pricing.html',
    reuseExistingServer: false,
    timeout: 15000
  }
});
