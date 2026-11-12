import { test, expect } from '@playwright/test';
import { bodyText, watch, dismissTour } from './support';

const PAGES = ['/', '/about', '/pricing', '/services/materials-testing', '/services/structural-design', '/services/project-management', '/inspecta-erp', '/team', '/contact', '/signup', '/login', '/forgot-password'];

test.describe('public site', () => {
  for (const path of PAGES) {
    test(`page ${path} loads with content and no errors`, async ({ page }) => {
      const w = watch(page);
      await page.goto(path);
      await page.waitForTimeout(1500);
      expect((await bodyText(page)).length).toBeGreaterThan(120);
      expect(w.errors).toEqual([]);
    });
  }

  test('every internal link on the landing page opens a real page', async ({ page }) => {
    await page.goto('/');
    const links = await page.locator('a[href^="/"]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('href')))].filter((h): h is string => !!h && h !== '/' && !h.includes('#') && !h.startsWith('/platform')));
    expect(links.length).toBeGreaterThan(3);
    for (const l of links.slice(0, 25)) {
      await page.goto(l);
      await expect.poll(async () => (await bodyText(page)).length, { message: `link ${l}`, timeout: 10_000 }).toBeGreaterThan(100);
    }
  });

  test('the book-a-demo button opens a form', async ({ page }) => {
    await dismissTour(page);
    await page.goto('/');
    const btn = page.getByRole('button', { name: /demo/i }).first();
    test.skip((await btn.count()) === 0, 'no demo button on this build');
    await btn.click();
    await expect(page.locator('form').first()).toBeVisible();
  });

  test('a wrong password shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'nobody@example.com');
    await page.fill('input[type="password"]', 'wrong-password');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    expect(page.url()).toMatch(/\/login/);
    expect(await bodyText(page)).toMatch(/invalid|incorrect|credentials|failed/i);
  });

  test('protected pages send a signed-out visitor to the login page', async ({ page }) => {
    for (const p of ['/dashboard', '/finance', '/production', '/reports']) {
      await page.goto(p);
      await expect(page).toHaveURL(/\/login/);
    }
  });
});
