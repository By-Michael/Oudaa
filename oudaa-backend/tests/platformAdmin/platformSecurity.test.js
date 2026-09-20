'use strict';

const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../../src/app');
const { prisma, resetDb, disconnectDb } = require('../testDb');
const { currentTotp, generateTotpSecret, encryptMfaSecret } = require('../../src/utils/platformMfa');

const SECURITY_BASE = '/api/platform/v1/security';
const AUTH_BASE = '/api/platform/v1/auth';

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnectDb();
});

async function createAdmin({ role = 'PLATFORM_ADMIN', email = `admin-${Date.now()}-${Math.random()}@hivee.local`, password = 'CorrectHorse123!', isActive = true, mfaEnabled = false } = {}) {
  const passwordHash = await bcrypt.hash(password, 12);
  let mfaSecretEnc = null;
  let secret = null;
  if (mfaEnabled) {
    secret = generateTotpSecret();
    mfaSecretEnc = encryptMfaSecret(secret);
  }
  const admin = await prisma.platformAdmin.create({
    data: { fullName: 'Test Operator', email, passwordHash, role, isActive, mfaEnabled, mfaSecretEnc },
  });
  return { admin, password, secret };
}

async function loginAsSuperAdmin() {
  const { admin, password, secret } = await createAdmin({ role: 'SUPER_ADMIN', mfaEnabled: true });
  const mfaCode = currentTotp(secret);
  const res = await request(app).post(`${AUTH_BASE}/login`).send({ email: admin.email, password, mfaCode });
  return { admin, token: res.body.data.accessToken };
}

async function loginAsPlatformAdmin(overrides = {}) {
  const { admin, password } = await createAdmin({ role: 'PLATFORM_ADMIN', ...overrides });
  const res = await request(app).post(`${AUTH_BASE}/login`).send({ email: admin.email, password });
  return { admin, token: res.body.data.accessToken };
}

// ─── dashboard overview ─────────────────────────────────────────────────────

describe('GET /security/overview', () => {
  it('rejects a PLATFORM_ADMIN (lacks SECURITY_VIEW)', async () => {
    const { token } = await loginAsPlatformAdmin();
    const res = await request(app).get(`${SECURITY_BASE}/overview`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('reflects a real failed login, a locked account, and an active session', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target, password } = await createAdmin({ role: 'SUPPORT_AGENT' });

    // 5 wrong passwords locks the account (see MAX_FAILED_LOGIN_ATTEMPTS).
    for (let i = 0; i < 5; i++) {
      await request(app).post(`${AUTH_BASE}/login`).send({ email: target.email, password: 'WrongPassword1' });
    }

    const res = await request(app).get(`${SECURITY_BASE}/overview`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.authentication.failedLogins).toBeGreaterThanOrEqual(5);
    expect(res.body.data.authentication.lockedAccounts).toBeGreaterThanOrEqual(1);
    expect(res.body.data.authentication.activeSessions).toBeGreaterThanOrEqual(1); // the SUPER_ADMIN's own session
    expect(res.body.data.mfa.totalAdmins).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body.data.recentPrivilegedOperations)).toBe(true);
  });

  it('flags a login against an unknown email as a suspicious event', async () => {
    const { token } = await loginAsSuperAdmin();
    await request(app).post(`${AUTH_BASE}/login`).send({ email: 'nobody-real@hivee.local', password: 'whatever123' });

    const res = await request(app).get(`${SECURITY_BASE}/overview`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.authentication.suspiciousLoginEvents).toBeGreaterThanOrEqual(1);
    expect(res.body.data.suspiciousEvents.some((e) => e.reason === 'unknown_email')).toBe(true);
  });
});

// ─── security events ────────────────────────────────────────────────────────

describe('GET /security/events', () => {
  it('filters to only the requested category', async () => {
    const { token } = await loginAsSuperAdmin();
    await request(app).post(`${AUTH_BASE}/login`).send({ email: 'nobody-real@hivee.local', password: 'whatever123' });

    const res = await request(app)
      .get(`${SECURITY_BASE}/events`)
      .query({ category: 'LOGIN_FAILURE' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((e) => e.action === 'LOGIN_FAILED')).toBe(true);
  });
});

// ─── sessions ────────────────────────────────────────────────────────────────

describe('GET /security/sessions and DELETE /security/sessions/:id', () => {
  it('lists sessions with admin identity attached, never a token hash', async () => {
    const { token } = await loginAsSuperAdmin();
    const res = await request(app).get(`${SECURITY_BASE}/sessions`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    res.body.data.forEach((s) => {
      expect(s.tokenHash).toBeUndefined();
      expect(s.admin?.email).toEqual(expect.any(String));
      expect(['active', 'revoked', 'expired']).toContain(s.status);
    });
  });

  it('revoking a session server-side actually invalidates it', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target, password } = await createAdmin({ role: 'SUPPORT_AGENT' });
    const targetLogin = await request(app).post(`${AUTH_BASE}/login`).send({ email: target.email, password });
    const targetToken = targetLogin.body.data.accessToken;

    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(targetToken);
    const session = await prisma.platformAdminSession.findFirst({ where: { platformAdminId: decoded.sub } });

    const res = await request(app)
      .delete(`${SECURITY_BASE}/sessions/${session.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true });
    expect(res.status).toBe(200);

    const check = await request(app).get(`${AUTH_BASE}/me`).set('Authorization', `Bearer ${targetToken}`);
    expect(check.status).toBe(401);
  });

  it('revoking an unknown session id 404s', async () => {
    const { token } = await loginAsSuperAdmin();
    const res = await request(app)
      .delete(`${SECURITY_BASE}/sessions/not-a-real-id`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true });
    expect(res.status).toBe(404);
  });
});

// ─── settings ────────────────────────────────────────────────────────────────

describe('GET/PATCH /security/settings', () => {
  it('a PLATFORM_ADMIN can view settings (has SETTINGS_VIEW) but not write them (lacks SECURITY_MANAGE)', async () => {
    const { token } = await loginAsPlatformAdmin();
    const getRes = await request(app).get(`${SECURITY_BASE}/settings`).set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);

    const patchRes = await request(app)
      .patch(`${SECURITY_BASE}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mfaRequiredForAllAdmins: true, reason: 'test', confirm: true });
    expect(patchRes.status).toBe(403);
  });

  it('a SUPER_ADMIN can update settings, and it is audited', async () => {
    const { admin, token } = await loginAsSuperAdmin();
    const res = await request(app)
      .patch(`${SECURITY_BASE}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ passwordMinLength: 16, reason: 'Tightening password policy', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.data.passwordMinLength).toBe(16);

    const auditRow = await prisma.platformAuditLog.findFirst({ where: { action: 'SECURITY_SETTINGS_UPDATED', actorId: admin.id } });
    expect(auditRow).toBeTruthy();
  });

  it('a newly-created admin must satisfy the updated password policy', async () => {
    const { token } = await loginAsSuperAdmin();
    await request(app)
      .patch(`${SECURITY_BASE}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ passwordMinLength: 20, reason: 'test', confirm: true });

    const res = await request(app)
      .post('/api/platform/v1/platform-admins')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Op', email: 'shortpw@hivee.local', password: 'Short1234567!', role: 'SUPPORT_AGENT', confirm: true });
    expect(res.status).toBe(400);
  });

  it('requires confirm: true and a reason to change settings', async () => {
    const { token } = await loginAsSuperAdmin();
    const res = await request(app)
      .patch(`${SECURITY_BASE}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ passwordMinLength: 16 });
    expect(res.status).toBe(400);
  });
});
