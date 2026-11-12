import { test, expect, Page, Browser } from '@playwright/test';
import { api, apiLogin, login, field, tab, optionText, bodyText, watch, dismissTour, WEB, API } from './support';

/**
 * One test per feature, driven through the real UI. A small realistic project is created through the API
 * in beforeAll and removed afterwards. Requires E2E_EMAIL / E2E_PASSWORD of a company admin.
 */
test.describe.configure({ mode: 'serial' });

const tag = Date.now().toString(36).slice(-6);
const NAME_A = `E2E Alpha ${tag}`;
const NAME_B = `E2E Beta ${tag}`;
let token = '';
let A: any, B: any, wA: any, wA2: any, mat: any, eng: { id: string; email: string };
const ENG_PW = 'Eng!Passw0rd-e2e';

test.beforeAll(async () => {
  test.skip(!process.env.E2E_EMAIL, 'E2E_EMAIL / E2E_PASSWORD are not set');
  token = await apiLogin();
  // leftovers from an interrupted earlier run
  const existing = await api('GET', '/projects?pageSize=200', undefined, token);
  for (const p of existing.data ?? []) if (/^E2E (Alpha|Beta) /.test(p.name)) await api('DELETE', `/projects/${p.id}`, undefined, token);
  await api('PUT', '/organization', { payrollEnabled: false }, token);

  A = (await api('POST', '/projects', { name: NAME_A, budget: 80_000_000 }, token)).data;
  B = (await api('POST', '/projects', { name: NAME_B, budget: 10_000_000 }, token)).data;
  const client = (await api('POST', '/clients', { name: `E2E Client ${tag}` }, token)).data;
  await api('POST', '/contracts', { clientId: client.id, projectId: A.id, reference: `E2E-${tag}`, value: 80_000_000 }, token);
  wA = (await api('POST', '/planning/wbs', { projectId: A.id, code: '1', name: 'Walls', unit: 'm2', quantity: 100 }, token)).data;
  wA2 = (await api('POST', '/planning/wbs', { projectId: A.id, code: '2', name: 'Slab' }, token)).data;
  await api('POST', '/planning/wbs', { projectId: B.id, code: '9', name: 'BetaOnlyTask' }, token);
  await api('POST', '/finance/budget', { projectId: A.id, wbsItemId: wA.id, description: 'Walls budget', amount: 3_000_000, category: 'MATERIAL' }, token);
  await api('POST', '/finance/budget', { projectId: A.id, description: 'Rest of the job', amount: 47_000_000, category: 'OTHER' }, token);
  await api('POST', '/production', { projectId: A.id, wbsItemId: wA.id, plannedQty: 100, actualQty: 50, laborHours: 8, date: new Date().toISOString() }, token);
  mat = (await api('POST', '/inventory/materials', { code: `E2E-${tag}`, name: `E2E Cement ${tag}`, unit: 'bag', unitCost: 400 }, token)).data;
  await api('POST', '/inventory/grn', { materialId: mat.id, projectId: A.id, quantityReceived: 100, unitCost: 500 }, token);
  await api('POST', '/inventory/material-issues', { materialId: mat.id, projectId: A.id, wbsItemId: wA.id, quantityIssued: 10 }, token);
  const sup = (await api('POST', '/procurement/suppliers', { name: `E2E Supplier ${tag}` }, token)).data;
  await api('POST', '/procurement/purchase-orders', { supplierId: sup.id, projectId: A.id, status: 'ISSUED', items: [{ description: 'Rebar', quantity: 50, rate: 2000, wbsItemId: wA2.id }] }, token);
  await api('POST', '/qaqc/material-tests', { projectId: A.id, wbsItemId: wA.id, testType: 'CONCRETE', batchNumber: 'E2E1', result: 'FAIL' }, token);
  const rq = (await api('POST', '/requisitions', { projectId: A.id, title: 'E2E own requisition', items: [{ materialId: mat.id, quantityRequested: 5, wbsItemId: wA.id }] }, token)).data;
  await api('POST', `/requisitions/${rq.id}/submit`, {}, token);
  await api('POST', '/approvals', { title: `E2E approval ${tag}`, entityType: 'INVOICE', projectId: A.id, amount: 7_000_000 }, token);
  const email = `e2e-foreman-${tag}@e2e.test`;
  const u = await api('POST', '/users', { email, fullName: 'Foreman Joe', password: ENG_PW, role: 'SITE_ENGINEER' }, token);
  expect(u.data?.id, `could not create the foreman: ${u.error}`).toBeTruthy();
  eng = { id: u.data.id, email };
  await api('PUT', `/users/${eng.id}/projects`, { projectIds: [A.id] }, token);
});

test.afterAll(async () => {
  if (!token) return;
  await api('DELETE', `/projects/${A?.id}`, undefined, token);
  await api('DELETE', `/projects/${B?.id}`, undefined, token);
  if (eng) await api('PUT', `/users/${eng.id}`, { isActive: false }, token);
  await api('PUT', '/organization', { payrollEnabled: false }, token);
});

async function pickProject(page: Page, name: string) {
  const picker = page.locator('#current-project-picker');
  await picker.selectOption({ label: await optionText(picker, name) });
  await page.waitForTimeout(600);
}

test('signing in lands on a dashboard with honest status badges', async ({ page }) => {
  const w = watch(page);
  await login(page);
  const t = await bodyText(page);
  expect(t).toMatch(/schedule spi/i);
  expect(t).not.toMatch(/ON TRACK[\s\S]{0,40}0\.87/); // no hard-coded badge
  expect(w.errors).toEqual([]);
});

test('the same numbers appear on every screen: progress 50%, SPI 0.5, profit', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  await page.goto('/production');
  await page.waitForTimeout(3500);
  let t = await bodyText(page);
  expect(t).toMatch(/50(\.0)?%/);
  expect(t).toMatch(/SPI 0\.5/);
  await page.goto('/finance');
  await page.waitForTimeout(3000);
  t = await bodyText(page);
  expect(t).toMatch(/80,000,000/); // contract value
  await page.goto('/profitability');
  await page.waitForTimeout(3000);
  t = await bodyText(page);
  expect(t).toMatch(/30,000,000/); // forecast profit = contract - budget
});

test('the current project follows you to every page', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  for (const path of ['/finance', '/production', '/inventory', '/reports', '/planning-dashboards', '/requisitions']) {
    await page.goto(path);
    await page.waitForTimeout(2800);
    const selected = await page.locator('select').evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).options[(e as HTMLSelectElement).selectedIndex]?.text ?? ''));
    expect(selected.filter((v) => v.includes(NAME_A)).length, `on ${path}`).toBeGreaterThanOrEqual(2);
  }
});

test('the project list (all projects) shows portfolio totals, not blanks', async ({ page }) => {
  await login(page);
  await pickProject(page, 'All projects').catch(async () => { await page.locator('#current-project-picker').selectOption(''); });
  await page.goto('/production');
  await page.waitForTimeout(3000);
  const t = await bodyText(page);
  expect(t).toMatch(/all projects/i);
  expect(t).toContain(NAME_A);
});

test('Finance: cost by WBS shows budget, actual and open purchase order commitments', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  await page.goto('/finance');
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Cost by WBS/ }).first().click();
  await page.waitForTimeout(2500);
  const t = await bodyText(page);
  expect(t).toMatch(/committed/i);
  expect(t).toMatch(/forecast/i);
  expect(t).toContain('Slab');
  expect(t).toMatch(/100,000/);
});

test('Production: plan the day, assign it to someone who can raise requisitions', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  await page.goto('/production');
  await page.waitForTimeout(2500);
  await tab(page, 'Daily Plans').click();
  await page.getByRole('button', { name: /Add Daily Plan/ }).click();
  const wbs = field(page, 'WBS task');
  const opts = await wbs.locator('option').allTextContents();
  expect(opts.some((o) => o.includes('Walls'))).toBe(true);
  expect(opts.some((o) => o.includes('BetaOnlyTask'))).toBe(false); // only this project's tasks
  await wbs.selectOption({ label: await optionText(wbs, 'Walls') });
  await field(page, 'Work planned').fill('Lay blocks level 1');
  await field(page, 'Planned quantity').fill('40');
  const asg = field(page, 'Assign to');
  expect((await asg.locator('option').allTextContents()).some((o) => o.includes('Foreman Joe'))).toBe(true);
  await asg.selectOption({ label: await optionText(asg, 'Foreman Joe') });
  await page.getByRole('button', { name: /^Create Daily Plan/ }).click();
  await page.waitForTimeout(2500);
  const t = await bodyText(page);
  expect(t).toContain('Lay blocks level 1');
  expect(t).toContain('Foreman Joe');
});

test('Requisitions: every material line needs a WBS task from this project', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  await page.goto('/requisitions');
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /New requisition|\+ New/i }).first().click();
  await page.waitForTimeout(1200);
  const lines = page.locator('xpath=//label[contains(.,"MATERIALS AND THE TASK")]/following::select');
  await lines.nth(0).selectOption({ label: await optionText(lines.nth(0), 'E2E Cement') });
  const wbs = lines.nth(1);
  const opts = await wbs.locator('option').allTextContents();
  expect(opts.some((o) => o.includes('Walls'))).toBe(true);
  expect(opts.some((o) => o.includes('BetaOnlyTask'))).toBe(false);
  await page.locator('input[placeholder="Qty"]').first().fill('15');
  const create = page.getByRole('button', { name: /Create Draft/ });
  await expect(create).toBeDisabled(); // no WBS chosen yet
  await wbs.selectOption({ label: await optionText(wbs, 'Walls') });
  await expect(create).toBeEnabled();
  await create.click();
  await page.waitForTimeout(2500);
  expect(await bodyText(page)).toMatch(/REQ-\d+/);
});

test('Requisitions: you cannot approve a requisition you raised yourself', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  await page.goto('/requisitions');
  await page.waitForTimeout(3500);
  const t = await bodyText(page);
  expect(t).toContain('E2E own requisition');
  expect(t).not.toMatch(/\bApprove\b/);
});

test('Procurement: a purchase request has item lines, each with a WBS task, and a calculated total', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  await page.goto('/procurement');
  await page.waitForTimeout(3000);
  await tab(page, 'Purchase Requests').click();
  await page.getByRole('button', { name: /Add Purchase Request/ }).click();
  await field(page, 'PR Number').fill(`PR-E2E-${tag}`);
  await field(page, 'Title').fill('Slab steel');
  const proj = field(page, 'Project');
  await proj.selectOption({ label: await optionText(proj, NAME_A) });
  await page.waitForTimeout(1000);
  await page.locator('input[aria-label="Item"]').first().fill('Rebar Y16');
  await page.locator('input[aria-label="Qty"]').first().fill('20');
  await page.locator('input[aria-label="Est. rate"]').first().fill('1500');
  const lineWbs = page.locator('xpath=//label[contains(.,"Items (the request amount")]/following::select[1]');
  const opts = await lineWbs.locator('option').allTextContents();
  expect(opts.some((o) => o.includes('Slab'))).toBe(true);
  expect(opts.some((o) => o.includes('BetaOnlyTask'))).toBe(false);
  await lineWbs.selectOption({ label: await optionText(lineWbs, 'Slab') });
  await page.getByRole('button', { name: /^Create Purchase Request/ }).click();
  await page.waitForTimeout(2500);
  const t = await bodyText(page);
  expect(t).toContain(`PR-E2E-${tag}`);
  expect(t).toMatch(/30,000/);
});

test('Quality and safety forms carry a WBS task', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  await page.goto('/qaqc');
  await page.waitForTimeout(2500);
  await tab(page, 'Material Tests').click();
  await page.getByRole('button', { name: /Add Material Test/ }).click();
  await expect(page.locator('xpath=//label[contains(.,"WBS Activity")]/following::select[1]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.goto('/hse');
  await page.waitForTimeout(2500);
  await tab(page, 'Incidents').click();
  await page.getByRole('button', { name: /Add Incident/ }).click();
  await expect(page.locator('xpath=//label[contains(.,"WBS Activity")]/following::select[1]')).toHaveCount(1);
});

test('A failed material test shows up as an NCR', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  await page.goto('/qaqc');
  await page.waitForTimeout(2500);
  await tab(page, 'NCR').click().catch(() => undefined);
  await page.waitForTimeout(2000);
  expect(await bodyText(page)).toMatch(/NCR-\d+/);
});

test('Approvals: one inbox for everything awaiting a decision, with level and approver', async ({ page }) => {
  await login(page);
  await page.goto('/approvals');
  await page.waitForTimeout(3000);
  const t = await bodyText(page);
  expect(t).toContain(`E2E approval ${tag}`);
  expect(t).toMatch(/Level 2/);
  expect(t).toMatch(/E2E own requisition|REQ-\d+/);
  await page.getByRole('button', { name: /New Request/ }).click();
  await expect(page.locator('select option', { hasText: 'Purchase order' })).not.toHaveCount(0); // typed, not free text
});

test('Inventory: material issues are auto-numbered and need a WBS task', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  await page.goto('/inventory');
  await page.waitForTimeout(3000);
  await tab(page, 'Material Issues').click();
  expect(await bodyText(page)).toMatch(/ISS-\d+/); // issues are numbered automatically
  await page.getByRole('button', { name: /Add Material Issue/ }).click();
  const wbs = field(page, 'WBS Item');
  expect(await wbs.locator('option').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('Walls')]));
});

test('Planning: an incomplete plan shows the guided setup banner', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_B);
  await page.goto('/planning');
  await page.waitForTimeout(3500);
  expect(await bodyText(page)).toMatch(/Set up this project's plan|Start guided setup/);
});

test('Payroll is off until a company admin switches it on in Administration', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await page.waitForTimeout(2000);
  await page.locator('text=People').first().click().catch(() => undefined);
  expect(await page.locator('aside, nav').first().innerText()).not.toContain('Payroll');
  await page.goto('/payroll');
  await page.waitForTimeout(2500);
  expect(await bodyText(page)).toMatch(/switched off/i);
  await page.goto('/admin');
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Company Settings/ }).click();
  const sw = page.getByRole('switch', { name: 'Payroll module' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.goto('/payroll');
  await page.waitForTimeout(3000);
  expect(await bodyText(page)).not.toMatch(/Payroll is switched off/i);
  await page.goto('/admin');
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Company Settings/ }).click();
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('Reports: designed PDFs and exports download from the page', async ({ page }) => {
  await login(page);
  await pickProject(page, NAME_A);
  await page.goto('/reports');
  await page.waitForTimeout(3000);
  const t = await bodyText(page);
  for (const name of ['Portfolio report', 'Project status report', 'Cost by WBS', 'Quality and safety report', 'Procurement report', 'Executive summary', 'Financial', 'Compliance']) expect(t).toContain(name);
  for (const id of ['portfolio', 'project', 'cost-wbs', 'quality', 'procurement']) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.locator(`[data-report="${id}"] button`).click()]);
    const file = await dl.path();
    const head = (await import('node:fs')).readFileSync(file!).subarray(0, 5).toString();
    expect(head, `${id} report`).toBe('%PDF-');
  }
  const [xl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.locator('[data-report="x-executive"] button').click()]);
  expect((await xl.suggestedFilename())).toMatch(/\.xlsx$/);
});

test('Copilot opens inside the app with the side menu', async ({ page }) => {
  await login(page);
  await page.goto('/copilot');
  await page.waitForTimeout(3000);
  const t = await bodyText(page);
  expect(t).toMatch(/Dashboard/);
  expect(t).toMatch(/Inventory/);
  expect(t).toMatch(/Copilot/i);
});

test('Executive Intelligence loads with no implausible CPI', async ({ page }) => {
  await login(page);
  await page.goto('/executive');
  await page.waitForTimeout(4500);
  const t = await bodyText(page);
  expect(t).toMatch(/Project Performance/);
  expect(t).not.toMatch(/\b6\.22\b/);
});

test('an assigned foreman only sees their own project, and the server refuses the rest', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, eng.email, ENG_PW);
  const picker = page.locator('#current-project-picker');
  await picker.waitFor({ timeout: 20_000 });
  const opts = await picker.locator('option').allTextContents();
  expect(opts.some((o) => o.includes(NAME_A))).toBe(true);
  expect(opts.some((o) => o.includes(NAME_B))).toBe(false);
  const status = await page.evaluate(async ({ api, id }) => (await fetch(`${api}/projects/${id}`, { headers: { Authorization: 'Bearer ' + localStorage.getItem('inspecta.accessToken') } })).status, { api: API, id: B.id });
  expect(status).toBe(403);
  await page.goto('/requisitions');
  await page.waitForTimeout(3000);
  expect(await bodyText(page)).not.toContain('Payroll');
  await ctx.close();
});

test('an expired session sends you back to the login page', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { localStorage.setItem('inspecta.accessToken', 'x'); localStorage.setItem('inspecta.refreshToken', 'x'); });
  await page.goto('/finance');
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
});
