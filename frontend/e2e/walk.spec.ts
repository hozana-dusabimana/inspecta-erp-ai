import { test, expect, Page } from '@playwright/test';
import { api, apiLogin, login, bodyText, watch, optionText } from './support';

/**
 * Walks every module of the app as a company admin: opens the page, every tab inside it, and the "Add" form of each tab.
 * A page fails when it shows an error, stays blank, throws in the browser, or triggers a refused API call.
 */
test.describe.configure({ mode: 'serial' });

const tag = Date.now().toString(36).slice(-6);
const NAME = `E2E Walk ${tag}`;
let token = '';
let P: any;

const MODULES = [
  '/dashboard', '/executive', '/portfolio', '/planning', '/planning-dashboards', '/scheduling', '/production', '/field-ops', '/equipment',
  '/hr', '/payroll', '/point-of-sale', '/finance', '/profitability', '/inventory', '/requisitions', '/procurement', '/qaqc', '/hse', '/risk',
  '/approvals', '/documents', '/reports', '/copilot', '/notifications', '/daily-entry', '/admin', '/billing',
];

test.beforeAll(async () => {
  test.skip(!process.env.E2E_EMAIL, 'E2E_EMAIL / E2E_PASSWORD are not set');
  token = await apiLogin();
  const existing = await api('GET', '/projects?pageSize=200', undefined, token);
  for (const p of existing.data ?? []) if (/^E2E Walk /.test(p.name)) await api('DELETE', `/projects/${p.id}`, undefined, token);
  P = (await api('POST', '/projects', { name: NAME, budget: 80_000_000 }, token)).data;
  const w = (await api('POST', '/planning/wbs', { projectId: P.id, code: '1', name: 'Block work', unit: 'm2', quantity: 100 }, token)).data;
  await api('POST', '/finance/budget', { projectId: P.id, wbsItemId: w.id, description: 'Walk budget', amount: 50_000_000, category: 'MATERIAL' }, token);
  await api('POST', '/production', { projectId: P.id, wbsItemId: w.id, plannedQty: 100, actualQty: 50, laborHours: 8, date: new Date().toISOString() }, token);
  await api('PUT', '/organization', { payrollEnabled: false }, token);
});

test.afterAll(async () => {
  if (token && P) await api('DELETE', `/projects/${P.id}`, undefined, token);
});

async function selectWalkProject(page: Page) {
  const picker = page.locator('#current-project-picker');
  if (await picker.count()) await picker.selectOption({ label: await optionText(picker, NAME) }).catch(() => undefined);
}

for (const path of MODULES) {
  test(`module ${path}: page, every tab, every Add form`, async ({ page }) => {
    const w = watch(page);
    await login(page);
    await selectWalkProject(page);
    w.clear();
    const problems: string[] = [];

    await page.goto(path);
    await page.waitForTimeout(2800);
    const t = await bodyText(page);
    if (t.length < 150) problems.push(`page looks blank (${t.length} characters)`);
    if (/something went wrong|application error|cannot read prop/i.test(t)) problems.push('error text on the page');
    problems.push(...w.errors.map((e) => `browser error: ${e}`), ...w.failed.map((f) => `refused request: ${f}`));
    w.clear();

    const tabs = page.locator('div.p-1.rounded-lg > button.rounded-md');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      const label = ((await tabs.nth(i).textContent()) ?? `tab ${i}`).trim();
      await tabs.nth(i).click();
      await page.waitForTimeout(1500);
      const tt = await bodyText(page);
      if (tt.length < 100) problems.push(`tab "${label}" looks blank`);
      if (/something went wrong|application error/i.test(tt)) problems.push(`tab "${label}" shows an error`);
      problems.push(...w.errors.map((e) => `tab "${label}" browser error: ${e}`), ...w.failed.map((f) => `tab "${label}" refused request: ${f}`));
      w.clear();

      const add = page.getByRole('button', { name: /^\s*Add\s/ }).first();
      if ((await add.count()) && (await add.isEnabled())) {
        await add.click();
        await page.waitForTimeout(1000);
        const inputs = await page.locator('form input, form select, form textarea').count();
        if (inputs === 0) problems.push(`tab "${label}": the Add form has no inputs`);
        problems.push(...w.errors.map((e) => `tab "${label}" form error: ${e}`), ...w.failed.map((f) => `tab "${label}" form refused request: ${f}`));
        w.clear();
        await page.keyboard.press('Escape');
        const close = page.getByRole('button', { name: /^(Cancel|Close)$/ }).first();
        if (await close.count()) await close.click().catch(() => undefined);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
}
