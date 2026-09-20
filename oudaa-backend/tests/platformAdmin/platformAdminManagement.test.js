'use strict';

const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../../src/app');
const { prisma, resetDb, disconnectDb } = require('../testDb');
const { currentTotp, generateTotpSecret, encryptMfaSecret } = require('../../src/utils/platformMfa');

const BASE = '/api/platform/v1/platform-admins';
const AUTH_BASE = '/api/platform/v1/auth';

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnectDb();
});

// ─── helpers ────────────────────────────────────────────────────────────────

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

// SUPER_ADMIN and SECURITY_AUDITOR are MFA-mandatory, so every "acting as"
// helper for those roles enrolls MFA up front and logs in with a valid
// TOTP code — this also gives the resulting session both `mfaVerified` AND
// a fresh `authenticatedAt`, satisfying requireRecentReauthentication
// without a separate step.
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

// ─── list / detail ──────────────────────────────────────────────────────────

describe('GET /platform-admins', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });

  it('rejects a PLATFORM_ADMIN (lacks ADMINS_VIEW)', async () => {
    const { token } = await loginAsPlatformAdmin();
    const res = await request(app).get(BASE).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('lists admins for a SUPER_ADMIN and never leaks secrets', async () => {
    const { admin, token } = await loginAsSuperAdmin();
    await createAdmin({ role: 'SUPPORT_AGENT' });

    const res = await request(app).get(BASE).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
    res.body.data.forEach((a) => {
      expect(a.passwordHash).toBeUndefined();
      expect(a.mfaSecretEnc).toBeUndefined();
      expect(a.mfaRecoveryCodeHashes).toBeUndefined();
    });
    expect(res.body.data.some((a) => a.id === admin.id)).toBe(true);
  });
});

// ─── create ─────────────────────────────────────────────────────────────────

describe('POST /platform-admins', () => {
  it('requires explicit confirm: true', async () => {
    const { token } = await loginAsSuperAdmin();
    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Op', email: 'new-op@hivee.local', password: 'GoodPass123!', role: 'SUPPORT_AGENT' });
    expect(res.status).toBe(400);
  });

  it('rejects a password that fails the configured policy', async () => {
    const { token } = await loginAsSuperAdmin();
    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Op', email: 'new-op@hivee.local', password: 'weak', role: 'SUPPORT_AGENT', confirm: true });
    expect(res.status).toBe(400);
    const created = await prisma.platformAdmin.findUnique({ where: { email: 'new-op@hivee.local' } });
    expect(created).toBeNull();
  });

  it('SUPER_ADMIN can create a new admin and it is recorded in the audit trail', async () => {
    const { admin: actor, token } = await loginAsSuperAdmin();
    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Op', email: 'new-op@hivee.local', password: 'GoodPass1234!', role: 'SUPPORT_AGENT', confirm: true });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('new-op@hivee.local');
    expect(res.body.data.passwordHash).toBeUndefined();

    const auditRow = await prisma.platformAuditLog.findFirst({ where: { action: 'ADMIN_CREATED', actorId: actor.id } });
    expect(auditRow).toBeTruthy();
  });

  it('a PLATFORM_ADMIN cannot create a SUPER_ADMIN (self-escalation guard, via subordinate creation)', async () => {
    const { token } = await loginAsPlatformAdmin();
    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Super', email: 'new-super@hivee.local', password: 'GoodPass1234!', role: 'SUPER_ADMIN', confirm: true });
    // Blocked either by lacking ADMINS_MANAGE outright, or (if it had the
    // permission) by the role-grant guard — either way, never 201.
    expect(res.status).not.toBe(201);
    const created = await prisma.platformAdmin.findUnique({ where: { email: 'new-super@hivee.local' } });
    expect(created).toBeNull();
  });
});

// ─── enable / disable ───────────────────────────────────────────────────────

describe('POST /platform-admins/:id/disable and /enable', () => {
  it('disables a target admin and revokes their active sessions', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target, password } = await createAdmin({ role: 'SUPPORT_AGENT' });
    const targetLogin = await request(app).post(`${AUTH_BASE}/login`).send({ email: target.email, password });
    expect(targetLogin.status).toBe(200);

    const res = await request(app)
      .post(`${BASE}/${target.id}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Suspicious activity reported', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    const sessions = await prisma.platformAdminSession.findMany({ where: { platformAdminId: target.id } });
    expect(sessions.every((s) => s.revoked)).toBe(true);

    // The disabled admin can no longer log back in.
    const retryLogin = await request(app).post(`${AUTH_BASE}/login`).send({ email: target.email, password });
    expect(retryLogin.status).toBe(403);
  });

  it('cannot disable your own account', async () => {
    const { admin, token } = await loginAsSuperAdmin();
    const res = await request(app)
      .post(`${BASE}/${admin.id}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'testing', confirm: true });
    expect(res.status).toBe(403);
  });

  it('re-enables a disabled admin', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target } = await createAdmin({ role: 'SUPPORT_AGENT', isActive: false });

    const res = await request(app)
      .post(`${BASE}/${target.id}/enable`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(true);
  });
});

// ─── role changes / self-escalation ─────────────────────────────────────────

describe('PATCH /platform-admins/:id/role — privilege self-escalation prevention', () => {
  it('SUPER_ADMIN can change another admin\'s role', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target } = await createAdmin({ role: 'SUPPORT_AGENT' });

    const res = await request(app)
      .patch(`${BASE}/${target.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'PLATFORM_ADMIN', reason: 'Promotion', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('PLATFORM_ADMIN');
  });

  it('an admin cannot change their own role, even with valid permission and reauth', async () => {
    const { admin, token } = await loginAsSuperAdmin();
    const res = await request(app)
      .patch(`${BASE}/${admin.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'SUPPORT_AGENT', reason: 'trying to demote myself', confirm: true });
    expect(res.status).toBe(403);

    const stillSuper = await prisma.platformAdmin.findUnique({ where: { id: admin.id } });
    expect(stillSuper.role).toBe('SUPER_ADMIN');
  });

  it('a PLATFORM_ADMIN lacks ADMINS_MANAGE entirely and cannot change any role', async () => {
    const { token } = await loginAsPlatformAdmin();
    const { admin: target } = await createAdmin({ role: 'SUPPORT_AGENT' });

    const res = await request(app)
      .patch(`${BASE}/${target.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'PLATFORM_ADMIN', reason: 'testing', confirm: true });
    expect(res.status).toBe(403);
  });

  it('requires recent re-authentication for a role change, even for a SUPER_ADMIN', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target } = await createAdmin({ role: 'SUPPORT_AGENT' });

    // Simulate an old session by directly rewriting authenticatedAt in the DB
    // to well outside the 15-minute step-up window.
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(token);
    await prisma.platformAdminSession.updateMany({
      where: { platformAdminId: decoded.sub },
      data: { authenticatedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const res = await request(app)
      .patch(`${BASE}/${target.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'PLATFORM_ADMIN', reason: 'testing', confirm: true });
    expect(res.status).toBe(401);
    expect(res.body.details?.code).toBe('REAUTHENTICATION_REQUIRED');
  });

  it('requires a reason', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target } = await createAdmin({ role: 'SUPPORT_AGENT' });
    const res = await request(app)
      .patch(`${BASE}/${target.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'PLATFORM_ADMIN', confirm: true });
    expect(res.status).toBe(400);
  });
});

// ─── forced password reset / MFA re-enrollment ──────────────────────────────

describe('POST /platform-admins/:id/require-password-reset', () => {
  it('flags the account, revokes sessions, and blocks it from doing anything else until reset', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target, password } = await createAdmin({ role: 'SUPPORT_AGENT' });
    const targetLogin = await request(app).post(`${AUTH_BASE}/login`).send({ email: target.email, password });
    const targetToken = targetLogin.body.data.accessToken;

    const res = await request(app)
      .post(`${BASE}/${target.id}/require-password-reset`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true });
    expect(res.status).toBe(200);

    // Old session is dead now.
    const meWithOldToken = await request(app).get(`${AUTH_BASE}/me`).set('Authorization', `Bearer ${targetToken}`);
    expect(meWithOldToken.status).toBe(401);

    // A fresh login succeeds (login itself is never blocked)...
    const relogin = await request(app).post(`${AUTH_BASE}/login`).send({ email: target.email, password });
    expect(relogin.status).toBe(200);
    const freshToken = relogin.body.data.accessToken;

    // ...but every other protected route is blocked until they change it.
    const blocked = await request(app).post(`${AUTH_BASE}/logout-all`).set('Authorization', `Bearer ${freshToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.details?.code).toBe('PASSWORD_RESET_REQUIRED');
  });

  it('cannot flag your own account', async () => {
    const { admin, token } = await loginAsSuperAdmin();
    const res = await request(app)
      .post(`${BASE}/${admin.id}/require-password-reset`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true });
    expect(res.status).toBe(403);
  });
});

describe('POST /platform-admins/:id/require-mfa-reenrollment', () => {
  it('wipes the MFA secret and requires re-enrollment before the account can proceed', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target, secret, password } = await createAdmin({ role: 'PLATFORM_ADMIN', mfaEnabled: true });

    const res = await request(app)
      .post(`${BASE}/${target.id}/require-mfa-reenrollment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true });
    expect(res.status).toBe(200);

    const updated = await prisma.platformAdmin.findUnique({ where: { id: target.id } });
    expect(updated.mfaEnabled).toBe(false);
    expect(updated.mfaReenrollmentRequired).toBe(true);

    // Their old TOTP code is no longer even relevant — login succeeds
    // without MFA (since mfaEnabled is now false)...
    const login = await request(app).post(`${AUTH_BASE}/login`).send({ email: target.email, password });
    expect(login.status).toBe(200);
    const freshToken = login.body.data.accessToken;

    // ...but every protected route demands re-enrollment first.
    const blocked = await request(app).get(`${AUTH_BASE}/me`).set('Authorization', `Bearer ${freshToken}`);
    // /me is intentionally exempt so the SPA can read the flag and route
    // to enrollment; a route that IS gated should 403 with the code below.
    const dashboard = await request(app).get('/api/platform/v1/dashboard/summary').set('Authorization', `Bearer ${freshToken}`);
    expect(dashboard.status).toBe(403);
    expect(dashboard.body.details?.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });
});

// ─── session revocation ─────────────────────────────────────────────────────

describe('POST /platform-admins/:id/revoke-sessions', () => {
  it('revokes every active session for the target admin server-side', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target, password } = await createAdmin({ role: 'SUPPORT_AGENT' });
    const login1 = await request(app).post(`${AUTH_BASE}/login`).send({ email: target.email, password });
    const login2 = await request(app).post(`${AUTH_BASE}/login`).send({ email: target.email, password });
    const token1 = login1.body.data.accessToken;
    const token2 = login2.body.data.accessToken;

    const res = await request(app)
      .post(`${BASE}/${target.id}/revoke-sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true });
    expect(res.status).toBe(200);

    const check1 = await request(app).get(`${AUTH_BASE}/me`).set('Authorization', `Bearer ${token1}`);
    const check2 = await request(app).get(`${AUTH_BASE}/me`).set('Authorization', `Bearer ${token2}`);
    expect(check1.status).toBe(401);
    expect(check2.status).toBe(401);
  });
});

// ─── activity / detail ──────────────────────────────────────────────────────

describe('GET /platform-admins/:id', () => {
  it('returns recent activity and active session count', async () => {
    const { token } = await loginAsSuperAdmin();
    const { admin: target } = await createAdmin({ role: 'SUPPORT_AGENT' });

    const res = await request(app).get(`${BASE}/${target.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(target.id);
    expect(Array.isArray(res.body.data.recentActivity)).toBe(true);
    expect(typeof res.body.data.activeSessionCount).toBe('number');
  });

  it('404s for a nonexistent admin', async () => {
    const { token } = await loginAsSuperAdmin();
    const res = await request(app).get(`${BASE}/not-a-real-id`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
