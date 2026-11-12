import { test, expect, Page } from '@playwright/test';
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

/** Waits past the page's first (possibly slow, under CI load) events fetch before reading its content. */
async function openDebugLog(page: Page) {
  await page.goto('/platform/debug-log');
  await expect(page.getByTestId('secrets-banner')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('debug-events-loading')).toHaveCount(0, { timeout: 20_000 });
}

test.beforeAll(async () => {
  test.skip(!PLATFORM_EMAIL, 'E2E_PLATFORM_EMAIL / E2E_PLATFORM_PASSWORD are not set');
  // make some events happen
  await api('POST', '/auth/register', { organizationName: `Dbg UI Co ${stamp}`, fullName: 'Dbg UI', email: signupEmail, password: 'Dbg!Passw0rd-1' });
  await api('POST', '/auth/login', { email: `nobody-${stamp}@e2e.test`, password: 'wrong' });
  platformToken = await apiLogin(PLATFORM_EMAIL, PLATFORM_PASSWORD);
  secretsRecorded = (await api('GET', '/platform/debug-log/status', undefined, platformToken)).data?.secretsRecorded === true;
  // events are written asynchronously (fire-and-forget); confirm via the API itself rather than a fixed pause
  await expect.poll(async () => (await api('GET', `/platform/debug-log?q=${stamp}&limit=20`, undefined, platformToken)).data?.events?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
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
  await openDebugLog(page);
  // No filter: the three events from beforeAll are the most recent in the whole log (nothing else
  // was writing to it in the gap since), so the default unfiltered, recency-ordered view holds all of
  // them — poll rather than read once, since the page keeps refetching live.
  await expect.poll(async () => bodyText(page), { timeout: 15_000 }).toContain('Company registered');
  const t = await bodyText(page);
  expect(t).toMatch(/Debug log/);
  expect(t).toMatch(/Sign-in refused: unknown or blocked account/);
  expect(t).toMatch(/Verification email NOT sent: SMTP is not configured|Email sent|Email FAILED/); // says why email did or did not go out
  expect(w.errors).toEqual([]);
});

test('verification links (the one-time codes) are shown only when recording is switched on', async ({ page }) => {
  await login(page, PLATFORM_EMAIL, PLATFORM_PASSWORD);
  await openDebugLog(page);
  if (secretsRecorded) {
    await expect(page.getByTestId('secrets-banner')).toContainText(/are being recorded/i);
    // No filter: a secret always renders inline for its event (see DebugLogPage), and the one from
    // beforeAll's registration is the most recent — searching by email wouldn't match anyway, since
    // neither the event's message nor its secret (a bare link, no email) contains the address.
    const link = page.locator('[data-secret]').first();
    await expect(link).toContainText('/verify-email?token=', { timeout: 15_000 });
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
  await openDebugLog(page);
  await page.getByRole('button', { name: 'EMAIL', exact: true }).click();
  await expect.poll(async () => page.locator('[data-event]').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  const cats = await page.locator('[data-event]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-event')))]);
  expect(cats).toEqual(['EMAIL']);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Level').selectOption('WARN');
  await expect.poll(async () => page.locator('[data-event]').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByLabel('Level').selectOption('');
  // The search box matches an event's message/secret text, not its structured metadata — "Company
  // registered: Dbg UI Co <stamp>" is a message that genuinely contains our marker.
  await page.getByLabel('Search the log').fill(stamp);
  await expect.poll(async () => bodyText(page), { timeout: 15_000 }).toContain('Company registered');
  if (secretsRecorded) {
    await page.getByLabel('Search the log').fill('');
    await page.getByLabel('Only codes / links').check();
    await expect.poll(async () => page.locator('[data-secret]').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  }
});

test('an event expands to show its details, and passwords never appear', async ({ page }) => {
  await login(page, PLATFORM_EMAIL, PLATFORM_PASSWORD);
  await openDebugLog(page);
  await page.getByLabel('Search the log').fill(stamp);
  await expect.poll(async () => page.locator('[data-event]').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.locator('[data-event] button').first().click();
  await expect(page.locator('pre').first()).toContainText('email');
  expect(await bodyText(page)).not.toContain('Dbg!Passw0rd-1');
});
