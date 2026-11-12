import { sanitizeMeta, extractSecrets, secretsEnabled, debugLogEnabled } from '../src/lib/debug-log';

describe('debug log rules', () => {
  it('never keeps credentials in metadata', () => {
    const out = sanitizeMeta({ email: 'a@b.c', password: 'hunter2', accessToken: 'abc', nested: { Authorization: 'Bearer x', ok: 1 }, apiKey: 'k' }) as Record<string, any>;
    expect(out.email).toBe('a@b.c');
    expect(out.password).toBe('[hidden]');
    expect(out.accessToken).toBe('[hidden]');
    expect(out.apiKey).toBe('[hidden]');
    expect(out.nested.Authorization).toBe('[hidden]');
    expect(out.nested.ok).toBe(1);
  });

  it('trims huge values and deep objects so one event cannot bloat the table', () => {
    const out = sanitizeMeta({ big: 'x'.repeat(2000), a: { b: { c: { d: { e: { f: 1 } } } } } }) as Record<string, any>;
    expect(String(out.big).length).toBeLessThan(600);
    expect(JSON.stringify(out.a)).toContain('[deep]');
  });

  it('finds the verification / reset links (the one-time codes) inside an email', () => {
    const body = 'Hi,\nConfirm here: https://app.example.com/verify-email?token=abc123def\nor reset: http://localhost:3000/reset-password?token=zzz999\nbye';
    expect(extractSecrets(body)).toBe('https://app.example.com/verify-email?token=abc123def\nhttp://localhost:3000/reset-password?token=zzz999');
    expect(extractSecrets('no links here')).toBeNull();
  });

  it('recording codes is off unless DEBUG_LOG_SECRETS=true; logging is on unless DEBUG_LOG=false', () => {
    const saved = { s: process.env.DEBUG_LOG_SECRETS, d: process.env.DEBUG_LOG };
    delete process.env.DEBUG_LOG_SECRETS; delete process.env.DEBUG_LOG;
    expect(secretsEnabled()).toBe(false);
    expect(debugLogEnabled()).toBe(true);
    process.env.DEBUG_LOG_SECRETS = 'true';
    expect(secretsEnabled()).toBe(true);
    process.env.DEBUG_LOG = 'false';
    expect(debugLogEnabled()).toBe(false);
    if (saved.s === undefined) delete process.env.DEBUG_LOG_SECRETS; else process.env.DEBUG_LOG_SECRETS = saved.s;
    if (saved.d === undefined) delete process.env.DEBUG_LOG; else process.env.DEBUG_LOG = saved.d;
  });
});
