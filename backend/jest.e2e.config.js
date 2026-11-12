/** End-to-end API suite: real app, real database (DATABASE_URL + JWT secrets from backend/.env or CI). */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/e2e'],
  testMatch: ['**/*.e2e.test.ts'],
  testTimeout: 60000,
  maxWorkers: 1,
  // The app starts timers (rate limiter, realtime); exit once tests finish.
  forceExit: true,
};
