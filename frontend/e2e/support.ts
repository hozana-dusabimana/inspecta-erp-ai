import { expect, Page, Locator } from '@playwright/test';

export const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
export const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api';
export const EMAIL = process.env.E2E_EMAIL ?? '';
export const PASSWORD = process.env.E2E_PASSWORD ?? '';

export interface ApiResult { status: number; success?: boolean; data?: any; error?: string; meta?: any }

export async function api(method: string, path: string, body?: unknown, token?: string): Promise<ApiResult> {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

export async function apiLogin(email = EMAIL, password = PASSWORD): Promise<string> {
  const r = await api('POST', '/auth/login', { email, password });
  if (!r.data?.accessToken) throw new Error(`API login failed for ${email}: ${r.error ?? r.status}`);
  return r.data.accessToken;
}

/** Skips the first-visit product tour whenever it appears. */
export async function dismissTour(page: Page) {
  await page.addLocatorHandler(
    page.getByRole('dialog', { name: 'Product tour' }).getByRole('button', { name: 'Skip', exact: true }),
    async (b) => { await b.click(); },
  );
}

export async function login(page: Page, email = EMAIL, password = PASSWORD) {
  await dismissTour(page);
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|requisitions|production|projects/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
}

/** The control that follows a form label (the forms don't associate labels by id). */
export function field(page: Page, label: string): Locator {
  return page.locator(`xpath=//label[contains(normalize-space(.), "${label}")]/following::*[self::select or self::input or self::textarea][1]`).first();
}

/** A module tab button (the segmented control under the page header). */
export function tab(page: Page, name: string): Locator {
  return page.locator('div.p-1.rounded-lg > button.rounded-md', { hasText: name }).first();
}

export async function optionText(select: Locator, contains: string): Promise<string> {
  const o = select.locator('option', { hasText: contains }).first();
  await expect(o).toHaveCount(1);
  return ((await o.textContent()) ?? '').trim();
}

export async function bodyText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

/** Collects uncaught browser errors and refused API calls during a test. */
export function watch(page: Page) {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on('response', (r) => {
    if (r.url().startsWith(API) && r.status() >= 400 && !r.url().includes('/auth/')) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '')}`.slice(0, 140));
  });
  return { errors, failed, clear() { errors.length = 0; failed.length = 0; } };
}
