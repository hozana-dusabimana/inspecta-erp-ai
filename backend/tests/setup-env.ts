// Runs before any test module is loaded (jest `setupFiles`).
//
// src/config/env.ts reads and validates the environment at import time and
// throws when DATABASE_URL is absent, so any unit test that transitively
// imports it used to depend on a developer's local backend/.env existing —
// green on a laptop, red in CI. These are inert placeholders: nothing here
// connects to a database or to Cloudinary, and real values in the environment
// still win.
const defaults: Record<string, string> = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-not-used-for-anything-real',
  JWT_REFRESH_SECRET: 'test-refresh-secret-not-used-for-anything-real',
  CLOUDINARY_CLOUD_NAME: 'testcloud',
  CLOUDINARY_API_KEY: 'test-key',
  CLOUDINARY_API_SECRET: 'test-secret',
  CLOUDINARY_FOLDER: 'inspecta',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
