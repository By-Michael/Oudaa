'use strict';

const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../../src/app');
const { prisma, resetDb, disconnectDb } = require('../testDb');
const { currentTotp } = require('../../src/utils/platformMfa');

const BASE = '/api/platform/v1';

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnectDb();
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function createPlatformAdmin(role = 'PLATFORM_ADMIN', email = 'ops@hivee.local') {
  const passwordHash = await bcrypt.hash('Password123!', 12);
  return prisma.platformAdmin.create({
    data: { fullName: 'Ops Admin', email, passwordHash, role, isActive: true },
  });
}

async function loginPlatformAdmin(email = 'ops@hivee.local', password = 'Password123!') {
  const res = await request(app)
    .post(`${BASE}/auth/login`)
    .send({ email, password });
  return res.body.data?.accessToken;
}


async function loginPlatformAdminWithMfa(email = 'super@hivee.local') {
  const token = await loginPlatformAdmin(email);
  const start = await request(app)
    .post(`${BASE}/auth/mfa/enroll/start`)
    .set('Authorization', `Bearer ${token}`);
  expect(start.status).toBe(200);
  const verify = await request(app)
    .post(`${BASE}/auth/mfa/enroll/verify`)
    .set('Authorization', `Bearer ${token}`)
    .send({ token: currentTotp(start.body.data.secret) });
  expect(verify.status).toBe(200);
  return token;
}

async function createCommunity(name, status = 'ACTIVE') {
  const slug = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
  return prisma.community.create({ data: { name, slug, status } });
}

async function createAdminUser(communityId) {
  const hash = await bcrypt.hash('P@ssword1!', 12);
  return prisma.user.create({
    data: {
      communityId,
      fullName: 'Comm Admin',
      email: `admin-${Date.now()}@example.com`,
      passwordHash: hash,
      role: 'ADMIN',
    },
  });
}

// ─── community directory ─────────────────────────────────────────────────────

describe('GET /communities — authentication', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get(`${BASE}/communities`);
    expect(res.status).toBe(401);
  });

  it('rejects community User JWT (wrong token type) with 401', async () => {
    const community = await createCommunity('TestComm');
    const hash = await bcrypt.hash('Pass1!', 12);
    const user = await prisma.user.create({
      data: {
        communityId: community.id,
        fullName: 'U',
        email: `u${Date.now()}@x.com`,
        passwordHash: hash,
        role: 'ADMIN',
      },
    });
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Pass1!', communitySlug: community.slug });
    const communityToken = loginRes.body.data?.accessToken;

    const res = await request(app)
      .get(`${BASE}/communities`)
      .set('Authorization', `Bearer ${communityToken}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /communities — platform admin access', () => {
  it('returns paginated community list for PLATFORM_ADMIN', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    await createCommunity('Alpha Community');
    await createCommunity('Beta Community');

    const res = await request(app)
      .get(`${BASE}/communities`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it('returns paginated community list for SUPER_ADMIN', async () => {
    await createPlatformAdmin('SUPER_ADMIN', 'super@hivee.local');
    const token = await loginPlatformAdminWithMfa('super@hivee.local');
    await createCommunity('Gamma Community');

    const res = await request(app)
      .get(`${BASE}/communities`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('returns 403 for FINANCE_OPERATOR (no COMMUNITIES_VIEW permission)', async () => {
    await createPlatformAdmin('FINANCE_OPERATOR', 'finance@hivee.local');
    const token = await loginPlatformAdmin('finance@hivee.local');

    const res = await request(app)
      .get(`${BASE}/communities`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('GET /communities — filtering & search', () => {
  it('filters by status=SUSPENDED', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    await createCommunity('Active Community', 'ACTIVE');
    await createCommunity('Suspended Community', 'SUSPENDED');

    const res = await request(app)
      .get(`${BASE}/communities?status=SUSPENDED`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((c) => c.status === 'SUSPENDED')).toBe(true);
  });

  it('searches by name substring', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    await createCommunity('Sunrise Heights');
    await createCommunity('Sunset Valley');

    const res = await request(app)
      .get(`${BASE}/communities?search=Sunrise`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.some((c) => c.name.includes('Sunrise'))).toBe(true);
  });

  it('respects pageSize parameter', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    for (let i = 0; i < 5; i++) await createCommunity(`Community ${i}`);

    const res = await request(app)
      .get(`${BASE}/communities?pageSize=2&page=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination.pageSize).toBe(2);
  });
});

describe('GET /communities/:id — community detail', () => {
  it('returns detail for an existing community', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const community = await createCommunity('Detail Community');
    await createAdminUser(community.id);

    const res = await request(app)
      .get(`${BASE}/communities/${community.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(community.id);
    expect(res.body.data.counts).toBeDefined();
    expect(res.body.data.diagnostics).toBeDefined();
  });

  it('returns 404 for a non-existent community', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();

    const res = await request(app)
      .get(`${BASE}/communities/non-existent-id-xyz`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /communities/:id/status — suspend / reactivate', () => {
  it('suspends an active community', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const community = await createCommunity('Suspendable');

    const res = await request(app)
      .patch(`${BASE}/communities/${community.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED', reason: 'Policy violation' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUSPENDED');
  });

  it('reactivates a suspended community', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const community = await createCommunity('WasSuspended', 'SUSPENDED');

    const res = await request(app)
      .patch(`${BASE}/communities/${community.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('returns 409 when setting the same status', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const community = await createCommunity('AlreadyActive', 'ACTIVE');

    const res = await request(app)
      .patch(`${BASE}/communities/${community.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(409);
  });

  it('rejects SUPPORT_AGENT (no COMMUNITIES_MANAGE permission)', async () => {
    await createPlatformAdmin('SUPPORT_AGENT', 'agent@hivee.local');
    const token = await loginPlatformAdmin('agent@hivee.local');
    const community = await createCommunity('AgentTest');

    const res = await request(app)
      .patch(`${BASE}/communities/${community.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(403);
  });
});

describe('GET /communities/:id/users — community user list', () => {
  it('returns users in the community', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const community = await createCommunity('UserTestComm');
    await createAdminUser(community.id);

    const res = await request(app)
      .get(`${BASE}/communities/${community.id}/users`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    // Must never include password hashes
    res.body.data.forEach((u) => {
      expect(u.passwordHash).toBeUndefined();
      expect(u.password).toBeUndefined();
    });
  });
});
