import { call, provisionTenant, destroyTenant, provisionPlatformAdmin, eventually, disconnect, Tenant, PASSWORD } from './harness';

/** The debug log: who can read it, what it captures, and when it keeps one-time links. */
let t: Tenant;
let platform: string;
const events = async (query = '') => (await call('get', `/platform/debug-log?limit=200${query}`, undefined, platform)).body.data;

beforeAll(async () => {
  process.env.DEBUG_LOG_SECRETS = 'false';
  t = await provisionTenant('dbg');
  platform = await provisionPlatformAdmin(t);
}, 120_000);

afterAll(async () => { delete process.env.DEBUG_LOG_SECRETS; await destroyTenant(t); await disconnect(); }, 60_000);

describe('debug log access', () => {
  it('only a platform admin can read or clear it', async () => {
    expect((await call('get', '/platform/debug-log', undefined, t.admin)).status).toBe(403);
    expect((await call('get', '/platform/debug-log/status', undefined, t.admin)).status).toBe(403);
    expect((await call('delete', '/platform/debug-log', undefined, t.admin)).status).toBe(403);
    expect((await call('get', '/platform/debug-log')).status).toBe(401);
    expect((await call('get', '/platform/debug-log', undefined, platform)).status).toBe(200);
  });
});

describe('what it captures', () => {
  it('records a refused sign-in with the reason but never the password', async () => {
    const email = `nobody-${Date.now()}@e2e.test`;
    expect((await call('post', '/auth/login', { email, password: 'My-Secret-Pa55' })).status).toBe(401);
    const hit = await eventually(async () => (await events('&category=AUTH')).events.find((e: any) => /unknown or blocked/.test(e.message) && e.meta?.email === email));
    expect(hit.level).toBe('WARN');
    expect(JSON.stringify(hit)).not.toContain('My-Secret-Pa55');
  });

  it('records sign-up, the email attempt and why it was not sent; links stay hidden while recording is off', async () => {
    const email = `signup-${Date.now()}@e2e.test`;
    const reg = await call('post', '/auth/register', { organizationName: `Dbg Co ${Date.now()}`, fullName: 'Dbg Person', email, password: PASSWORD });
    expect(reg.status).toBe(201);
    const registered = await eventually(async () => (await events('&category=AUTH')).events.find((e: any) => /Company registered/.test(e.message) && e.meta?.email === email));
    expect(registered).toBeTruthy();
    const issued = await eventually(async () => (await events('&category=AUTH')).events.find((e: any) => /Verification link issued/.test(e.message) && e.meta?.email === email));
    expect(issued.secret).toBeNull(); // DEBUG_LOG_SECRETS is off
    const mail = await eventually(async () => (await events('&category=EMAIL')).events.find((e: any) => e.meta?.to?.includes?.(email)));
    expect(mail.level).toBe('WARN'); // no SMTP in the test environment: the log says exactly that
    expect(mail.message).toMatch(/SMTP is not configured/);
  });

  it('keeps the verification link ONLY while DEBUG_LOG_SECRETS=true, and can filter to just the codes', async () => {
    process.env.DEBUG_LOG_SECRETS = 'true';
    const email = `codes-${Date.now()}@e2e.test`;
    await call('post', '/auth/register', { organizationName: `Dbg Codes ${Date.now()}`, fullName: 'Code Person', email, password: PASSWORD });
    const issued = await eventually(async () => (await events('&category=AUTH&only=secrets')).events.find((e: any) => /Verification link issued/.test(e.message) && e.meta?.email === email));
    expect(issued.secret).toMatch(/\/verify-email\?token=[0-9a-f]{64}$/);
    // The link in the log really verifies the account: it is the one-time code.
    const token = issued.secret.split('token=')[1];
    const verified = await call('post', '/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    const done = await eventually(async () => (await events('&category=AUTH')).events.find((e: any) => /Email verified/.test(e.message) && e.meta?.email === email));
    expect(done).toBeTruthy();
    const status = (await call('get', '/platform/debug-log/status', undefined, platform)).body.data;
    expect(status.secretsRecorded).toBe(true);
    expect(status.smtpConfigured).toBe(false);
    process.env.DEBUG_LOG_SECRETS = 'false';
  });

  it('records refused and failing API calls without query strings', async () => {
    await call('get', '/projects?access_token=should-not-be-logged');
    const hit = await eventually(async () => (await events('&category=HTTP')).events.find((e: any) => /GET \/api\/projects -> 401/.test(e.message)));
    expect(JSON.stringify(hit)).not.toContain('should-not-be-logged');
  });
});

describe('search and housekeeping', () => {
  it('filters by level and text, reports status, and can be cleared', async () => {
    const warns = (await events('&level=WARN')).events;
    expect(warns.length).toBeGreaterThan(0);
    expect(warns.every((e: any) => e.level === 'WARN')).toBe(true);
    const found = (await events('&q=SMTP')).events;
    expect(found.some((e: any) => /SMTP/.test(e.message))).toBe(true);
    const status = (await call('get', '/platform/debug-log/status', undefined, platform)).body.data;
    expect(status.total).toBeGreaterThan(0);
    expect(status.emailFailures24h).toBeGreaterThan(0);
    const cleared = await call('delete', '/platform/debug-log', undefined, platform);
    expect(cleared.body.data.deleted).toBeGreaterThan(0);
    const after = (await events()).events;
    expect(after.every((e: any) => /cleared/i.test(e.message))).toBe(true); // only the "cleared" notice remains
  });
});
