import { defineConfig } from '@playwright/test';

/**
 * Real-browser end-to-end tests (npm run test:e2e).
 *   E2E_WEB_URL   web app (default http://localhost:3000)
 *   E2E_API_URL   API     (default http://localhost:4000/api)
 *   E2E_EMAIL / E2E_PASSWORD   a company admin to sign in with (created by backend/scripts/e2e-seed.ts in CI)
 *   E2E_CHROMIUM_PATH          optional path to an installed Chromium/Chrome
 *   E2E_LIVE=1                 run only the read-only public checks (live.spec.ts) against E2E_WEB_URL/E2E_API_URL
 *   E2E_HEADED=1               show the browser window while the tests run (E2E_SLOW_MO=150 slows each action so you can follow)
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: !process.env.E2E_HEADED,
    launchOptions: {
      ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
      ...(process.env.E2E_SLOW_MO ? { slowMo: Number(process.env.E2E_SLOW_MO) } : {}),
    },
  },
  testIgnore: process.env.E2E_LIVE ? ['**/features.spec.ts', '**/walk.spec.ts', '**/public.spec.ts'] : ['**/live.spec.ts'],
});
