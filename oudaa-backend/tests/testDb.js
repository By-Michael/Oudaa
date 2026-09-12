const prisma = require('../src/config/prisma');

// Every app table, in no particular order — TRUNCATE ... CASCADE handles
// foreign key ordering for us. Keep this in sync with prisma/schema.prisma
// @@map(...) names if you add new tables — run
// `grep -n "@@map" prisma/schema.prisma` to check this list is complete.
// (This list was previously missing several tables added after it was
// written — community_payment_methods, community_bank_account_history,
// support_chat_sessions/messages, password_reset_tokens,
// profile_change_otps, project_fund_allocations, and
// committee_auto_approvals — meaning any test touching those wouldn't
// actually get a clean slate between tests. Fixed here.)
const TABLES = [
  'communities',
  'community_payment_methods',
  'community_bank_account_history',
  'users',
  'support_chat_sessions',
  'support_chat_messages',
  'audit_logs',
  'refresh_tokens',
  'password_reset_tokens',
  'profile_change_otps',
  'residents',
  'fees',
  'payments',
  'funds',
  'projects',
  'project_fund_allocations',
  'expenses',
  'receipts',
  'committee_transfer_requests',
  'committee_transfer_approvals',
  'pending_changes',
  'pending_change_approvals',
  'committee_auto_approvals',
];

/**
 * Wipes every app table. Call this in beforeEach (or afterEach) so tests
 * don't see leftover data from a previous test.
 */
async function resetDb() {
  const quoted = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`);
}

async function disconnectDb() {
  await prisma.$disconnect();
}

module.exports = { prisma, resetDb, disconnectDb };
