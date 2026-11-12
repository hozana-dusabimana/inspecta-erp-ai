import { test, expect } from '@playwright/test';
import { API, bodyText, watch } from './support';

/**
 * Read-only checks against a deployed site (no login, nothing is created):
 *   E2E_LIVE=1 E2E_WEB_URL=https://www.inspecta.africa E2E_API_URL=https://api.inspecta.africa/api npx playwright test
 */
test.describe('deployed site (read-only)', () => {
  test('API is healthy', async () => {
    const r = await (await fetch(`${API}/health`)).json();
    expect(r.success).toBe(true);
    expect(r.data.status).toBe('ok');
  });

  for (const p of ['/approvals/inbox', '/hr/headcount', '/dashboards/executive', '/portfolio/comparison', '/finance/cost-by-wbs', '/production/daily-plans', '/production/daily-plans/assignees', '/reports/portfolio.pdf', '/requisitions', '/pos/products', '/qaqc/material-tests']) {
    test(`endpoint ${p} exists and requires a login`, async () => {
      expect((await fetch(API + p)).status).toBe(401);
    });
  }

  for (const path of ['/', '/about', '/pricing', '/inspecta-erp', '/team', '/contact', '/signup', '/login', '/forgot-password']) {
    test(`public page ${path} loads without errors`, async ({ page }) => {
      const w = watch(page);
      await page.goto(path);
      await page.waitForTimeout(2000);
      expect((await bodyText(page)).length).toBeGreaterThan(120);
      expect(w.errors).toEqual([]);
    });
  }

  test('signed-out visitors are sent to the login page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
