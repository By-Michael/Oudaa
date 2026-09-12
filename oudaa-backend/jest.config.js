/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // Loaded before any test file or app module is imported, so DATABASE_URL
  // (read by src/config/prisma.js) and JWT secrets are set in time.
  // See tests/env.setup.js for details.
  setupFiles: ['./tests/env.setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  // Truncation-based resetDb() isn't safe to run concurrently against the
  // same test database, so tests also run with --runInBand (see package.json).
  testTimeout: 30000,
};
