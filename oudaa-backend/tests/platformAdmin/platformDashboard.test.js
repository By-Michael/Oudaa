const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../../src/app');
const { prisma, resetDb, disconnectDb } = require('../testDb');
const { currentTotp, generateTotpSecret, encryptMfaSecret } = require('../../src/utils/platformMfa');

const AUTH = '/api/platform/v1/auth';
const DASH = '/api/platform/v1/dashboard';
const SEARCH = '/api/platform/v1/search';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
});

async function loginAs(role, { mfaEnabled = false } = {}) {
  const password = 'CorrectHorse123!';
  const passwordHash = await bcrypt.hash(password, 12);
  let secret = null;
  let mfaSecretEnc = null;
  if (mfaEnabled) {
    secret = generateTotpSecret();
    mfaSecretEnc = encryptMfaSecret(secret);
  }
  const admin = await prisma.platformAdmin.create({
    data: { fullName: `Test ${role}`, email: `${role.toLowerCase()}@hivee.local`, passwordHash, role, isActive: true, mfaEnabled, mfaSecretEnc },
  });
  const mfaCode = mfaEnabled ? currentTotp(secret) : undefined;
  const res = await request(app).post(`${AUTH}/login`).send({ email: admin.email, password, mfaCode });
  return { admin, token: res.body.data.accessToken };
}

// SUPER_ADMIN and SECURITY_AUDITOR require mandatory MFA — helper that
// logs in AND completes enrollment so tests needing a fully-unblocked
// session for those roles don't each have to repeat the enroll dance.
async function loginAndEnroll(role) {
  const { admin, token } = await loginAs(role);
  const start = await request(app).post(`${AUTH}/mfa/enroll/start`).set('Authorization', `Bearer ${token}`);
  const verify = await request(app)
    .post(`${AUTH}/mfa/enroll/verify`)
    .set('Authorization', `Bearer ${token}`)
    .send({ token: currentTotp(start.body.data.secret) });
  expect(verify.status).toBe(200);
  return { admin, token };
}

describe('Dashboard authorization', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get(`${DASH}/summary`);
    expect(res.status).toBe(401);
  });

  it('rejects a role with DASHBOARD_VIEW blocked purely by missing MFA (mandatory role)', async () => {
    const { token } = await loginAs('SUPER_ADMIN'); // not yet MFA-enrolled
    const res = await request(app).get(`${DASH}/summary`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.details?.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('allows a non-mandatory-MFA role straight through to the dashboard', async () => {
    const { token } = await loginAs('SUPPORT_AGENT');
    const res = await request(app).get(`${DASH}/summary`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.metrics).toBeDefined();
    expect(res.body.data.financial).toBeDefined();
    expect(res.body.data.systemStatus).toBeDefined();
  });

  it('gates the financial-activity chart on PERFORMANCE_VIEW specifically', async () => {
    // SUPPORT_AGENT has DASHBOARD_VIEW but NOT PERFORMANCE_VIEW.
    const { token } = await loginAs('SUPPORT_AGENT');
    const res = await request(app).get(`${DASH}/charts/financial-activity`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('allows a role with PERFORMANCE_VIEW to load the financial-activity chart', async () => {
    const { token } = await loginAs('FINANCE_OPERATOR');
    const res = await request(app).get(`${DASH}/charts/financial-activity`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.series)).toBe(true);
  });
});

describe('Aggregate correctness', () => {
  async function seedCoreData() {
    await prisma.community.create({ data: { id: 'com-active', name: 'Active Co', slug: 'active-co', status: 'ACTIVE' } });
    await prisma.community.create({ data: { id: 'com-suspended', name: 'Suspended Co', slug: 'suspended-co', status: 'SUSPENDED' } });
    await prisma.user.create({ data: { id: 'usr-admin', communityId: 'com-active', fullName: 'Admin One', email: 'admin1@test.local', passwordHash: 'x', role: 'ADMIN' } });
    await prisma.user.create({ data: { id: 'usr-resident', communityId: 'com-active', fullName: 'Resident One', email: 'resident1@test.local', passwordHash: 'x', role: 'RESIDENT' } });
  }

  it('reports correct total/active/suspended community counts and role breakdowns', async () => {
    await seedCoreData();
    const { token } = await loginAs('SUPPORT_AGENT');
    const res = await request(app).get(`${DASH}/summary`).set('Authorization', `Bearer ${token}`);

    expect(res.body.data.metrics.communities.total).toBe(2);
    expect(res.body.data.metrics.communities.active).toBe(1);
    expect(res.body.data.metrics.communities.suspended).toBe(1);
    expect(res.body.data.metrics.users.total).toBe(2);
    expect(res.body.data.metrics.users.communityAdmins).toBe(1);
    expect(res.body.data.metrics.users.residents).toBe(1);
  });

  it('reports zero (not "unavailable") for genuinely empty counts', async () => {
    const { token } = await loginAs('SUPPORT_AGENT');
    const res = await request(app).get(`${DASH}/summary`).set('Authorization', `Bearer ${token}`);
    expect(res.body.data.metrics.communities.total).toBe(0);
    expect(res.body.data.financial.payments.total).toBe(0);
  });

  it('financial aggregates correctly bucket payment statuses', async () => {
    await seedCoreData();
    await prisma.resident.create({ data: { id: 'res-1', communityId: 'com-active', userId: 'usr-resident', unitNumber: 'A1' } });
    await prisma.fund.create({ data: { id: 'fund-1', communityId: 'com-active', name: 'General Fund' } });
    await prisma.payment.createMany({
      data: [
        { id: 'pay-1', communityId: 'com-active', residentId: 'res-1', fundId: 'fund-1', amount: 100, paymentMethod: 'CASH', status: 'VERIFIED' },
        { id: 'pay-2', communityId: 'com-active', residentId: 'res-1', fundId: 'fund-1', amount: 50, paymentMethod: 'CASH', status: 'PENDING' },
        { id: 'pay-3', communityId: 'com-active', residentId: 'res-1', fundId: 'fund-1', amount: 25, paymentMethod: 'CASH', status: 'REJECTED' },
      ],
    });

    const { token } = await loginAs('SUPPORT_AGENT');
    const res = await request(app).get(`${DASH}/summary`).set('Authorization', `Bearer ${token}`);

    expect(res.body.data.financial.payments.total).toBe(3);
    expect(res.body.data.financial.payments.verified).toBe(1);
    expect(res.body.data.financial.payments.pending).toBe(1);
    expect(res.body.data.financial.payments.rejected).toBe(1);
    expect(res.body.data.financial.payments.totalAmount).toBe(175);
  });
});

describe('System status — never fabricates', () => {
  it('reports NOT_CONFIGURED for optional services with no credentials in the test env', async () => {
    const { token } = await loginAs('SUPPORT_AGENT');
    const res = await request(app).get(`${DASH}/summary`).set('Authorization', `Bearer ${token}`);
    // The test environment intentionally has no BREVO/VERITAS/GROQ/SUPABASE
    // credentials configured (see tests/env.setup.js), so these must never
    // read as HEALTHY.
    expect(res.body.data.systemStatus.database.status).toBe('HEALTHY');
    expect(['NOT_CONFIGURED', 'UNKNOWN']).toContain(res.body.data.systemStatus.email.status);
    expect(['NOT_CONFIGURED', 'UNKNOWN']).toContain(res.body.data.systemStatus.storage.status);
  });
});

describe('Global search authorization and grouping', () => {
  it('rejects an unauthenticated search', async () => {
    const res = await request(app).get(SEARCH).query({ q: 'green' });
    expect(res.status).toBe(401);
  });

  it('returns tooShort for a 1-character query', async () => {
    const { token } = await loginAs('SUPPORT_AGENT');
    const res = await request(app).get(SEARCH).set('Authorization', `Bearer ${token}`).query({ q: 'a' });
    expect(res.status).toBe(200);
    expect(res.body.data.tooShort).toBe(true);
  });

  it('finds a matching community by partial name, case-insensitively', async () => {
    await prisma.community.create({ data: { id: 'com-1', name: 'Greenwood Community', slug: 'greenwood', status: 'ACTIVE' } });
    const { token } = await loginAs('SUPPORT_AGENT');
    const res = await request(app).get(SEARCH).set('Authorization', `Bearer ${token}`).query({ q: 'GREENwood' });
    expect(res.status).toBe(200);
    const group = res.body.data.groups.find((g) => g.category === 'communities');
    expect(group.results[0].title).toBe('Greenwood Community');
  });

  it('a role without AUDIT_VIEW never gets an audit group even if a matching audit row exists', async () => {
    await prisma.platformAuditLog.create({ data: { action: 'ROLE_CHANGED', entityType: 'PlatformAdmin', description: 'Community admin role changed for X' } });
    const { token } = await loginAs('SUPPORT_AGENT'); // no AUDIT_VIEW
    const res = await request(app).get(SEARCH).set('Authorization', `Bearer ${token}`).query({ q: 'role changed' });
    expect(res.body.data.groups.find((g) => g.category === 'audit')).toBeUndefined();
  });

  it('a role WITH AUDIT_VIEW does get the audit group for the same query', async () => {
    await prisma.platformAuditLog.create({ data: { action: 'ROLE_CHANGED', entityType: 'PlatformAdmin', description: 'Community admin role changed for X' } });
    const { token } = await loginAndEnroll('SUPER_ADMIN');
    const res = await request(app).get(SEARCH).set('Authorization', `Bearer ${token}`).query({ q: 'role changed' });
    expect(res.body.data.groups.find((g) => g.category === 'audit')).toBeDefined();
  });
});

describe('Recent activity — permission-specific visibility', () => {
  it('omits auditEvents for a role without AUDIT_VIEW', async () => {
    const { token } = await loginAs('SUPPORT_AGENT');
    const res = await request(app).get(`${DASH}/recent-activity`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.auditEvents).toBeUndefined();
    expect(res.body.data.supportActivity).toBeDefined();
  });

  it('includes auditEvents for SECURITY_AUDITOR', async () => {
    const { token } = await loginAndEnroll('SECURITY_AUDITOR');
    const res = await request(app).get(`${DASH}/recent-activity`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.auditEvents).toBeDefined();
  });
});
