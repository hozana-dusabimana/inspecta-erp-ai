import { call, provisionTenant, destroyTenant, disconnect, Tenant } from './harness';

/** Two companies on one database must never see or block each other. */
let X: Tenant;
let Y: Tenant;

beforeAll(async () => {
  X = await provisionTenant('tenx');
  Y = await provisionTenant('teny');
}, 120_000);

afterAll(async () => { await destroyTenant(X); await destroyTenant(Y); await disconnect(); }, 60_000);

describe('company isolation', () => {
  it('auto-numbered codes are per company: both companies can create EMP-0001 and EQ-0001', async () => {
    for (const t of [X, Y]) {
      const emp = await call('post', '/hr/employees', { fullName: 'First Employee' }, t.admin);
      expect(emp.status).toBe(201);
      expect(emp.body.data.employeeNo).toBe('EMP-0001');
      const eq = await call('post', '/equipment/register', { name: 'First Machine' }, t.admin);
      expect(eq.status).toBe(201);
      expect(eq.body.data.code).toBe('EQ-0001');
    }
  });

  it('one company cannot read, change or link to another company\'s records', async () => {
    const proj = await call('post', '/projects', { name: 'X private job', budget: 1_000_000 }, X.admin);
    expect(proj.status).toBe(201);
    const id = proj.body.data.id;
    expect((await call('get', `/projects/${id}`, undefined, Y.admin)).status).toBe(404);
    expect((await call('put', `/projects/${id}`, { name: 'hijacked' }, Y.admin)).status).toBe(404);
    expect((await call('delete', `/projects/${id}`, undefined, Y.admin)).status).toBe(404);
    const list = await call('get', '/projects?pageSize=100', undefined, Y.admin);
    expect(list.body.data.some((p: any) => p.id === id)).toBe(false);
    // Writing a record that points at the other company's project is refused.
    const link = await call('post', '/planning/wbs', { projectId: id, code: '1', name: 'sneaky' }, Y.admin);
    expect([400, 403, 404]).toContain(link.status);
    // Reports for another company's project are not available either.
    const pdf = await call('get', `/reports/project/${id}.pdf`, undefined, Y.admin);
    expect([403, 404]).toContain(pdf.status);
  });

  it('dashboards only count the caller\'s own company', async () => {
    const a = (await call('get', '/dashboards/executive', undefined, X.admin)).body.data.portfolio.totalProjects;
    const b = (await call('get', '/dashboards/executive', undefined, Y.admin)).body.data.portfolio.totalProjects;
    expect(a).toBe(1);
    expect(b).toBe(0);
  });
});

describe('authentication basics', () => {
  it('rejects missing/invalid tokens and wrong passwords', async () => {
    expect((await call('get', '/projects')).status).toBe(401);
    expect((await call('get', '/projects', undefined, 'not-a-token')).status).toBe(401);
    expect((await call('post', '/auth/login', { email: X.adminEmail, password: 'wrong-password' })).status).toBe(401);
  });
});
