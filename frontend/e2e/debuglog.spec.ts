import { test, expect } from '@playwright/test';
import { api, apiLogin, login, bodyText, watch } from './support';

/**
 * The Debug log page (Platform console). Needs E2E_PLATFORM_EMAIL / E2E_PLATFORM_PASSWORD (a platform admin)
 * and, for the "codes are visible" assertions, the API started with DEBUG_LOG_SECRETS=true (the page adapts if not).
 */
const PLATFORM_EMAIL = process.env.E2E_PLATFORM_EMAIL ?? '';
const PLATFORM_PASSWORD = process.env.E2E_PLATFORM_PASSWORD ?? '';
const stamp = Date.now().toString(36);
const signupEmail = `dbg-ui-${stamp}@e2e.test`;
let platformToken = '';
let secretsRecorded = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.skip(!PLATFORM_EMAIL, 'E2E_PLATFORM_EMAIL / E2E_PLATFORM_PASSWORD are not set');
  // make some events happen
  await api('POST', '/auth/register', { organizationName: `Dbg UI Co ${stamp}`, fullName: 'Dbg UI', email: signupEmail, password: 'Dbg!Passw0rd-1' });
  await api('POST', '/auth/login', { email: `nobody-${stamp}@e2e.test`, password: 'wrong' });
  platformToken = await apiLogin(PLATFORM_EMAIL, PLATFORM_PASSWORD);
  secretsRecorded = (await api('GET', '/platform/debug-log/status', undefined, platformToken)).data?.secretsRecorded === true;
  await new Promise((r) => setTimeout(r, 1500)); // events are written asynchronously
});

test('a company admin cannot read the debug log (server and page)', async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL, 'needs a company admin');
  const companyToken = await apiLogin();
  expect((await api('GET', '/platform/debug-log', undefined, companyToken)).status).toBe(403);
  await login(page);
  await page.goto('/platform/debug-log');
  await page.waitForTimeout(2500);
  const t = await bodyText(page);
  expect(t).not.toContain(signupEmail);
  expect(t).not.toMatch(/Verification link issued/);
});

test('the platform admin sees sign-ups, sign-ins and the email problem in one place', async ({ page }) => {
  const w = watch(page);
  await login(page, PLATFORM_EMAIL, PLATFORM_PASSWORD);
  await page.goto('/platform/debug-log');
  await expect(page.getByTestId('secrets-banner')).toBeVisible({ timeout: 20_000 });
  const t = await bodyText(page);
  expect(t).toMatch(/Debug log/);
  expect(t).toContain('Company registered');
  expect(t).toMatch(/Sign-in refused: unknown or blocked account/);
  expect(t).toMatch(/Verification email NOT sent: SMTP is not configured|Email sent|Email FAILED/); // says why email did or did not go out
  expect(w.errors).toEqual([]);
});

test('verification links (the one-time codes) are shown only when recording is switched on', async ({ page }) => {
  await login(page, PLATFORM_EMAIL, PLATFORM_PASSWORD);
  await page.goto('/platform/debug-log');
  await expect(page.getByTestId('secrets-banner')).toBeVisible({ timeout: 20_000 });
  if (secretsRecorded) {
    await expect(page.getByTestId('secrets-banner')).toContainText(/are being recorded/i);
    await page.getByLabel('Search the log').fill(signupEmail);
    await page.waitForTimeout(2500);
    const link = page.locator('[data-secret]').first();
    await expect(link).toContainText('/verify-email?token=');
    // the code in the log really activates the account
    const token = (await link.innerText()).split('token=')[1].trim();
    expect((await api('POST', '/auth/verify-email', { token })).status).toBe(200);
  } else {
    await expect(page.getByTestId('secrets-banner')).toContainText(/are hidden/i);
    await expect(page.locator('[data-secret]')).toHaveCount(0);
  }
});

test('filters: category, level, search and "only codes"', async ({ page }) => {
  await login(page, PLATFORM_EMAIL, PLATFORM_PASSWORD);
  await page.goto('/platform/debug-log');
  await page.waitForSelector('[data-event]', { timeout: 20_000 });
  await page.getByRole('button', { name: 'EMAIL', exact: true }).click();
  await page.waitForTimeout(1800);
  const cats = await page.locator('[data-event]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-event')))]);
  expect(cats).toEqual(['EMAIL']);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Level').selectOption('WARN');
  await page.waitForTimeout(1800);
  expect(await page.locator('[data-event]').count()).toBeGreaterThan(0);
  await page.getByLabel('Level').selectOption('');
  await page.getByLabel('Search the log').fill(`nobody-${stamp}`);
  await page.waitForTimeout(1800);
  expect(await bodyText(page)).toContain(`nobody-${stamp}`);
  if (secretsRecorded) {
    await page.getByLabel('Search the log').fill('');
    await page.getByLabel('Only codes / links').check();
    await page.waitForTimeout(1800);
    expect(await page.locator('[data-secret]').count()).toBeGreaterThan(0);
  }
});

test('an event expands to show its details, and passwords never appear', async ({ page }) => {
  await login(page, PLATFORM_EMAIL, PLATFORM_PASSWORD);
  await page.goto('/platform/debug-log');
  await page.waitForSelector('[data-event]', { timeout: 20_000 });
  await page.getByLabel('Search the log').fill(`nobody-${stamp}`);
  await page.waitForTimeout(1800);
  await page.locator('[data-event] button').first().click();
  await expect(page.locator('pre').first()).toContainText('email');
  expect(await bodyText(page)).not.toContain('Dbg!Passw0rd-1');
});
