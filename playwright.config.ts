import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.TEST_ORIGIN ?? 'http://127.0.0.1:3000',
    viewport: { width: 1365, height: 1000 },
    trace: 'retain-on-failure',
  },
  reporter: 'list',
});
