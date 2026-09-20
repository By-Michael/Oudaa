'use strict';

const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../../src/app');
const { prisma, resetDb, disconnectDb } = require('../testDb');

const BASE = '/api/platform/v1';

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnectDb();
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function createPlatformAdmin(role = 'PLATFORM_ADMIN', email = 'ops@hivee.local') {
  const hash = await bcrypt.hash('Password123!', 12);
  return prisma.platformAdmin.create({
    data: { fullName: 'Ops Admin', email, passwordHash: hash, role, isActive: true },
  });
}

async function loginPlatformAdmin(email = 'ops@hivee.local') {
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password: 'Password123!' });
  return res.body.data?.accessToken;
}

async function createCommunityWithAdmin() {
  const slug = 'test-' + Date.now();
  const community = await prisma.community.create({ data: { name: 'Test', slug } });
  const hash = await bcrypt.hash('Pass1!', 12);
  const user = await prisma.user.create({
    data: {
      communityId: community.id,
      fullName: 'Comm Admin',
      email: `admin-${Date.now()}@example.com`,
      passwordHash: hash,
      role: 'ADMIN',
    },
  });
  return { community, user };
}

// ─── global user list ────────────────────────────────────────────────────────

describe('GET /users — authentication', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get(`${BASE}/users`);
    expect(res.status).toBe(401);
  });

  it('rejects community admin tokens', async () => {
    const { community, user } = await createCommunityWithAdmin();
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Pass1!', communitySlug: community.slug });
    const token = loginRes.body.data?.accessToken;

    const res = await request(app)
      .get(`${BASE}/users`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /users — platform admin access', () => {
  it('returns a list with pagination for PLATFORM_ADMIN', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    await createCommunityWithAdmin();

    const res = await request(app).get(`${BASE}/users`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  it('NEVER returns password hashes or tokens in any result', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    await createCommunityWithAdmin();

    const res = await request(app).get(`${BASE}/users`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    res.body.data.forEach((u) => {
      expect(u.passwordHash).toBeUndefined();
      expect(u.mfaSecretEnc).toBeUndefined();
      expect(u.refreshTokens).toBeUndefined();
    });
  });

  it('filters by communityId', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const { community, user } = await createCommunityWithAdmin();

    const res = await request(app)
      .get(`${BASE}/users?communityId=${community.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((u) => u.communityId === community.id)).toBe(true);
  });

  it('filters by role=ADMIN', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    await createCommunityWithAdmin();

    const res = await request(app)
      .get(`${BASE}/users?role=ADMIN`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((u) => u.role === 'ADMIN')).toBe(true);
  });

  it('searches by email substring', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const { user } = await createCommunityWithAdmin();
    const emailPrefix = user.email.split('@')[0];

    const res = await request(app)
      .get(`${BASE}/users?search=${emailPrefix}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.some((u) => u.email === user.email)).toBe(true);
  });
});

describe('GET /users/:id — user detail', () => {
  it('returns safe user detail', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const { user } = await createCommunityWithAdmin();

    const res = await request(app)
      .get(`${BASE}/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(user.id);
    expect(res.body.data.email).toBe(user.email);
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data.sessions).toBeDefined();
    expect(res.body.data.auditHistory).toBeDefined();
  });

  it('returns 404 for non-existent user', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();

    const res = await request(app)
      .get(`${BASE}/users/no-such-user-id`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /users/:id/revoke-sessions', () => {
  it('revokes sessions (USERS_MANAGE permission required)', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const { user } = await createCommunityWithAdmin();

    const res = await request(app)
      .post(`${BASE}/users/${user.id}/revoke-sessions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('rejects SUPPORT_AGENT (no USERS_MANAGE)', async () => {
    await createPlatformAdmin('SUPPORT_AGENT', 'agent@hivee.local');
    const token = await loginPlatformAdmin('agent@hivee.local');
    const { user } = await createCommunityWithAdmin();

    const res = await request(app)
      .post(`${BASE}/users/${user.id}/revoke-sessions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /users/:id/support-view — view-as', () => {
  it('starts a support view session and returns a sessionId', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const { user } = await createCommunityWithAdmin();

    const res = await request(app)
      .post(`${BASE}/users/${user.id}/support-view`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(res.body.data.sessionId).toBeDefined();
    expect(res.body.data.expiresAt).toBeDefined();
    expect(res.body.data.targetUser.email).toBe(user.email);
    // Must not return secrets
    expect(res.body.data.targetUser.passwordHash).toBeUndefined();
  });

  it('creates an audit log record for the view-as', async () => {
    await createPlatformAdmin();
    const token = await loginPlatformAdmin();
    const { user } = await createCommunityWithAdmin();

    await request(app)
      .post(`${BASE}/users/${user.id}/support-view`)
      .set('Authorization', `Bearer ${token}`);

    const auditEntry = await prisma.platformAuditLog.findFirst({
      where: { action: 'SUPPORT_VIEW_STARTED', entityId: user.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('rejects FINANCE_OPERATOR (no IMPERSONATION_USE)', async () => {
    await createPlatformAdmin('FINANCE_OPERATOR', 'fin@hivee.local');
    const token = await loginPlatformAdmin('fin@hivee.local');
    const { user } = await createCommunityWithAdmin();

    const res = await request(app)
      .post(`${BASE}/users/${user.id}/support-view`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('prevents cross-operator session access', async () => {
    // Operator A starts a session
    const opA = await createPlatformAdmin('PLATFORM_ADMIN', 'opa@hivee.local');
    const tokenA = await loginPlatformAdmin('opa@hivee.local');
    // Operator B
    await createPlatformAdmin('PLATFORM_ADMIN', 'opb@hivee.local');
    const tokenB = await loginPlatformAdmin('opb@hivee.local');

    const { user } = await createCommunityWithAdmin();

    const startRes = await request(app)
      .post(`${BASE}/users/${user.id}/support-view`)
      .set('Authorization', `Bearer ${tokenA}`);

    const sessionId = startRes.body.data?.sessionId;

    // Operator B tries to use operator A's session
    const viewRes = await request(app)
      .get(`${BASE}/users/support-view/${sessionId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(viewRes.status).toBe(403);
  });
});

describe('Tenant isolation', () => {
  it('community admin cannot call global /users endpoint', async () => {
    const { community, user } = await createCommunityWithAdmin();
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Pass1!', communitySlug: community.slug });
    const token = loginRes.body.data?.accessToken;

    const res = await request(app)
      .get(`${BASE}/users`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('community admin cannot call /communities endpoint', async () => {
    const { community, user } = await createCommunityWithAdmin();
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Pass1!', communitySlug: community.slug });
    const token = loginRes.body.data?.accessToken;

    const res = await request(app)
      .get(`${BASE}/communities`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
