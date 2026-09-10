import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // Run sequentially to avoid port/state conflicts during chaos tests
  forbidOnly: !!process.env.CI,
  retries: 0, // Retries are handled internally by our ApplicationEngine resilience layer
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'node dist/server/index.js',
    port: 3000,
    reuseExistingServer: true,
    timeout: 15000
  }
});
