// Loaded by Jest (see jest.config.js: setupFiles) BEFORE any test file or
// application module is imported. This is what makes it safe to run tests:
// src/config/prisma.js reads process.env.DATABASE_URL when it's first
// required, so this file must set that env var before anything else runs.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.test') });

process.env.NODE_ENV = 'test';

// Fail loudly instead of silently testing against the wrong database.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set for tests. Copy oudaa-backend/.env.test.example ' +
      'to oudaa-backend/.env.test and point it at a TEST database (never production).'
  );
}
if (!process.env.DATABASE_URL.includes('test')) {
  // Not foolproof, but catches the #1 mistake: accidentally reusing the
  // dev/production DATABASE_URL for tests, which would wipe real data.
  console.warn(
    '\n[tests] WARNING: DATABASE_URL does not contain "test" — double-check ' +
      'this is NOT your production/Supabase database before continuing.\n'
  );
}

// JWT secrets used by src/utils/tokens.js — tests need these set even if
// .env.test doesn't define them.
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

// Platform-admin secrets — deliberately different values from the
// community ones above, same as they must be in real deployments.
process.env.PLATFORM_JWT_ACCESS_SECRET = process.env.PLATFORM_JWT_ACCESS_SECRET || 'test-platform-access-secret';
process.env.PLATFORM_JWT_REFRESH_SECRET = process.env.PLATFORM_JWT_REFRESH_SECRET || 'test-platform-refresh-secret';
process.env.PLATFORM_JWT_ACCESS_EXPIRES_IN = process.env.PLATFORM_JWT_ACCESS_EXPIRES_IN || '10m';
process.env.PLATFORM_JWT_REFRESH_EXPIRES_IN = process.env.PLATFORM_JWT_REFRESH_EXPIRES_IN || '8h';
process.env.PLATFORM_MFA_ENCRYPTION_KEY = process.env.PLATFORM_MFA_ENCRYPTION_KEY || 'test-platform-mfa-key';
process.env.PLATFORM_ADMIN_CORS_ORIGIN = process.env.PLATFORM_ADMIN_CORS_ORIGIN || 'http://localhost:5174';
