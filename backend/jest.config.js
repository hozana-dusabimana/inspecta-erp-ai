/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // Inert env defaults so tests that import src/config/env don't depend on a
  // developer's local backend/.env (which CI does not have).
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
};
