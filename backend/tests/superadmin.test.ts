import { shouldSyncSeedPassword } from '../src/modules/auth/superadmin';

const AT = new Date('2026-07-01T09:00:00Z');

describe('seeded superadmin password reconciliation', () => {
  it('writes the configured password while the account has never been used', () => {
    // The exact case that produces a baffling "Invalid credentials": the first
    // seed wrote one password, the env was corrected later, and the old upsert
    // never touched the hash again.
    expect(shouldSyncSeedPassword({ lastLoginAt: null, passwordMatches: false, forceReset: false })).toBe(true);
  });

  it('leaves a password alone once a human has signed in', () => {
    expect(shouldSyncSeedPassword({ lastLoginAt: AT, passwordMatches: false, forceReset: false })).toBe(false);
  });

  it('does nothing when the stored hash already matches the configured password', () => {
    expect(shouldSyncSeedPassword({ lastLoginAt: null, passwordMatches: true, forceReset: false })).toBe(false);
  });

  it('honours the break-glass override even for an account in active use', () => {
    expect(shouldSyncSeedPassword({ lastLoginAt: AT, passwordMatches: false, forceReset: true })).toBe(true);
  });

  it('applies email and password together when SEED_ADMIN_EMAIL renames the account', () => {
    // Exactly the production case: the live superadmin was seeded under an old
    // address and has been used since. Moving only the email would leave the
    // documented email/password pair failing.
    expect(shouldSyncSeedPassword({ lastLoginAt: AT, passwordMatches: false, forceReset: false, isRename: true })).toBe(true);
  });

  it('still writes nothing on a rename when the password already matches', () => {
    expect(shouldSyncSeedPassword({ lastLoginAt: AT, passwordMatches: true, forceReset: false, isRename: true })).toBe(false);
  });
});
