/**
 * Bootstraps a single SUPER_ADMIN platform account for local development.
 * Idempotent — safe to run more than once (updates the password if the
 * account already exists rather than erroring or duplicating it).
 *
 * Usage: npm run seed:platform
 * Reads credentials from PLATFORM_SEED_EMAIL / PLATFORM_SEED_PASSWORD env
 * vars if set, otherwise falls back to a clearly-labeled local-dev default
 * — never used in production, since production should create its first
 * SUPER_ADMIN via a one-off secure process, not a checked-in script.
 */
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');

const EMAIL = process.env.PLATFORM_SEED_EMAIL || 'super.admin@hivee.local';
const PASSWORD = process.env.PLATFORM_SEED_PASSWORD || 'ChangeMe123!Now';

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.PLATFORM_SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error(
      'Refusing to seed a platform admin in production. ' +
        'Set PLATFORM_SEED_ALLOW_PRODUCTION=true only for a deliberate one-off bootstrap.'
    );
  }
  if (process.env.NODE_ENV === 'production' && !process.env.PLATFORM_SEED_PASSWORD) {
    throw new Error(
      'Refusing to seed a platform admin in production with the default password. ' +
        'Set PLATFORM_SEED_EMAIL and PLATFORM_SEED_PASSWORD explicitly.'
    );
  }

  const existing = await prisma.platformAdmin.findUnique({ where: { email: EMAIL } });
  if (existing && process.env.NODE_ENV === 'production' && process.env.PLATFORM_SEED_UPDATE_EXISTING !== 'true') {
    throw new Error(
      'Platform admin already exists. Set PLATFORM_SEED_UPDATE_EXISTING=true only when deliberately rotating the seeded account.'
    );
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const admin = await prisma.platformAdmin.upsert({
    where: { email: EMAIL },
    update: { passwordHash, role: 'SUPER_ADMIN', isActive: true },
    create: {
      fullName: 'Super Admin',
      email: EMAIL,
      passwordHash,
      role: 'SUPER_ADMIN',
      isActive: true,
    },
  });

  console.log(`Platform admin ready: ${admin.email} (role: ${admin.role})`);
  if (!process.env.PLATFORM_SEED_PASSWORD) {
    console.log(`Password: ${PASSWORD} (default — change this immediately outside local dev)`);
  }
  console.log(
    'Note: this role requires MFA. Log in once, then complete MFA enrollment ' +
      '(POST /api/platform/v1/auth/mfa/enroll/start then /mfa/enroll/verify) before other endpoints unlock.'
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
