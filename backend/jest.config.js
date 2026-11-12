/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // The end-to-end suite needs a real database: it runs with `npm run test:e2e` (jest.e2e.config.js).
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
  // Inert env defaults so tests that import src/config/env don't depend on a
  // developer's local backend/.env (which CI does not have).
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
};
