const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const {
  signPlatformAccessToken,
  signPlatformRefreshToken,
  verifyPlatformRefreshToken,
  hashPlatformToken,
  REFRESH_EXPIRES_MS,
} = require('../../utils/platformTokens');
const {
  generateTotpSecret,
  verifyTotp,
  buildOtpAuthUrl,
  encryptMfaSecret,
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
} = require('../../utils/platformMfa');
const { isMfaMandatoryForRole } = require('../../config/platformPermissions');
const { recordPlatformAudit, recordPlatformAuditUnauthenticated } = require('../../services/platformAdmin/platformAuditService');
const { getSecuritySettings } = require('../../services/platformAdmin/platformSecuritySettingsService');
const { assertPasswordMeetsPolicy } = require('../../utils/passwordPolicy');

// Deliberately separate cookie name + path from the community side's
// 'oudaa_refresh_token' (see oudaa-backend's authController.js) — a
// browser signed into both a community portal and the platform console
// (e.g. an operator testing their own demo tenant) must never have one
// cookie collide with or overwrite the other.
const REFRESH_COOKIE_NAME = 'hivee_platform_refresh';
const REFRESH_COOKIE_PATH = '/api/platform/v1/auth';

// Lockout policy: after this many consecutive failed attempts, the account
// is locked for LOCKOUT_MINUTES regardless of subsequent correct
// passwords, until the lockout window itself elapses. Distinct from (and
// in addition to) the IP-keyed rate limiter on the route (see
// platformAuthRoutes.js) — this one follows the ACCOUNT, so distributing
// guesses across many IPs doesn't help an attacker either.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function refreshCookieOptions(maxAgeMs = REFRESH_EXPIRES_MS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: Math.max(0, Math.floor(maxAgeMs)),
    path: REFRESH_COOKIE_PATH,
  };
}

function sanitizeAdmin(admin) {
  const { passwordHash, mfaSecretEnc, mfaRecoveryCodeHashes, ...safe } = admin;
  return safe;
}

async function createSessionAndIssueTokens(res, req, admin, { mfaVerified }) {
  const settings = await getSecuritySettings();
  const sessionTtlMs = Math.max(5 * 60 * 1000, Number(settings.sessionDurationMinutes || 480) * 60 * 1000);
  const authenticatedAt = new Date();
  const expiresAt = new Date(authenticatedAt.getTime() + sessionTtlMs);
  const session = await prisma.platformAdminSession.create({
    data: {
      platformAdminId: admin.id,
      tokenHash: 'pending', // replaced immediately below once we know the refresh token
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
      mfaVerified,
      authenticatedAt,
      expiresAt,
    },
  });

  const refreshToken = signPlatformRefreshToken(admin, session, Math.ceil(sessionTtlMs / 1000));
  const updatedSession = await prisma.platformAdminSession.update({
    where: { id: session.id },
    data: { tokenHash: hashPlatformToken(refreshToken) },
  });

  const accessToken = signPlatformAccessToken(admin, updatedSession);

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(sessionTtlMs));
  return { accessToken, refreshToken, session: updatedSession };
}

/**
 * Platform-admin login. Deliberately NOT the same endpoint or code path as
 * the community authController.login — this looks up PlatformAdmin, never
 * User, so there is no shared query, no shared password hash comparison
 * call, and no shared token signer between the two.
 */
const login = catchAsync(async (req, res) => {
  const { email, password, mfaCode, recoveryCode } = req.body;
  const normalizedEmail = email.trim().toLowerCase();

  const admin = await prisma.platformAdmin.findUnique({ where: { email: normalizedEmail } });

  if (!admin) {
    await recordPlatformAuditUnauthenticated(req, {
      action: 'LOGIN_FAILED',
      entityType: 'PlatformAdmin',
      description: `Login attempt for unknown email ${normalizedEmail}`,
      attemptedEmail: normalizedEmail,
      metadata: { reason: 'unknown_email' },
    });
    throw new AppError('Invalid credentials', 401);
  }

  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    await recordPlatformAuditUnauthenticated(req, {
      action: 'LOGIN_FAILED',
      entityType: 'PlatformAdmin',
      description: `Login attempt while account locked: ${normalizedEmail}`,
      attemptedEmail: normalizedEmail,
      metadata: { reason: 'account_locked' },
    });
    throw new AppError('This account is temporarily locked due to repeated failed login attempts. Please try again later.', 423);
  }

  if (!admin.isActive) {
    await recordPlatformAuditUnauthenticated(req, {
      action: 'LOGIN_FAILED',
      entityType: 'PlatformAdmin',
      description: `Login attempt on disabled account: ${normalizedEmail}`,
      attemptedEmail: normalizedEmail,
      metadata: { reason: 'account_disabled' },
    });
    throw new AppError('This platform admin account has been disabled', 403);
  }

  const validPassword = await bcrypt.compare(password, admin.passwordHash);
  if (!validPassword) {
    const failedLoginCount = admin.failedLoginCount + 1;
    const lockingNow = failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS;
    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        failedLoginCount,
        lastFailedLoginAt: new Date(),
        lastFailedLoginIp: req.ip || null,
        lockedUntil: lockingNow ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : admin.lockedUntil,
      },
    });
    await recordPlatformAuditUnauthenticated(req, {
      action: 'LOGIN_FAILED',
      entityType: 'PlatformAdmin',
      description: `Incorrect password for ${normalizedEmail}${lockingNow ? ' — account now locked' : ''}`,
      attemptedEmail: normalizedEmail,
      metadata: { failedLoginCount, reason: 'invalid_password' },
    });
    throw new AppError('Invalid credentials', 401);
  }

  // --- MFA gate ---
  let mfaVerified = false;
  if (admin.mfaEnabled) {
    if (recoveryCode) {
      const hashes = Array.isArray(admin.mfaRecoveryCodeHashes) ? admin.mfaRecoveryCodeHashes : [];
      const candidateHash = hashRecoveryCode(recoveryCode);
      if (!hashes.includes(candidateHash)) {
        await recordPlatformAuditUnauthenticated(req, {
          action: 'LOGIN_FAILED',
          entityType: 'PlatformAdmin',
          description: `Invalid MFA recovery code for ${normalizedEmail}`,
          attemptedEmail: normalizedEmail,
          metadata: { reason: 'invalid_recovery_code' },
        });
        throw new AppError('Invalid recovery code', 401);
      }
      // Single-use: consume it immediately.
      await prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { mfaRecoveryCodeHashes: hashes.filter((h) => h !== candidateHash) },
      });
      mfaVerified = true;
    } else if (mfaCode) {
      const secret = decryptMfaSecret(admin.mfaSecretEnc);
      if (!verifyTotp(secret, mfaCode)) {
        await recordPlatformAuditUnauthenticated(req, {
          action: 'LOGIN_FAILED',
          entityType: 'PlatformAdmin',
          description: `Invalid MFA code for ${normalizedEmail}`,
          attemptedEmail: normalizedEmail,
          metadata: { reason: 'invalid_mfa_code' },
        });
        throw new AppError('Invalid authentication code', 401);
      }
      mfaVerified = true;
    } else {
      // Correct password, but no MFA code supplied yet — tell the
      // frontend to show the MFA step rather than issuing any tokens.
      return res.status(200).json({
        success: true,
        mfaRequired: true,
        message: 'Enter your authenticator code to continue.',
      });
    }
  }
  // Note: if this role mandates MFA (see isMfaMandatoryForRole) but none
  // is enrolled yet, we deliberately do NOT block login here — the admin
  // still needs a valid session to reach the enrollment endpoints at all.
  // Instead, a normal (mfaVerified: false) session is issued below, and
  // requireMfa (applied to every OTHER protected route, but not the
  // /mfa/enroll/* routes) is what actually stops them from doing anything
  // besides completing enrollment. This avoids a chicken-and-egg deadlock
  // where a mandatory-MFA role could never log in to enroll MFA.

  // Successful authentication: reset lockout counters.
  await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: req.ip || null,
    },
  });

  const { accessToken, session } = await createSessionAndIssueTokens(res, req, admin, { mfaVerified });

  req.platformAdmin = { id: admin.id, role: admin.role, email: admin.email, fullName: admin.fullName };
  await recordPlatformAudit(req, {
    action: 'LOGIN_SUCCESS',
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    description: `${admin.email} logged in`,
    metadata: { sessionId: session.id },
  });

  res.json({
    success: true,
    data: { admin: sanitizeAdmin(admin), accessToken },
  });
});

const refresh = catchAsync(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
  if (!token) throw new AppError('Refresh token missing', 401);

  let payload;
  try {
    payload = verifyPlatformRefreshToken(token);
  } catch {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  const stored = await prisma.platformAdminSession.findUnique({ where: { id: payload.sid } });
  if (!stored || stored.revoked || stored.expiresAt < new Date() || stored.tokenHash !== hashPlatformToken(token)) {
    throw new AppError('Session is no longer valid', 401);
  }

  const admin = await prisma.platformAdmin.findUnique({ where: { id: payload.sub } });
  if (!admin || !admin.isActive) throw new AppError('Platform admin no longer exists or is disabled', 401);

  // Rotate: revoke the used refresh token, issue a fresh one under a new
  // session row (mfaVerified/authenticatedAt carried forward — refreshing
  // never re-triggers or extends the reauthentication clock).
  await prisma.platformAdminSession.update({ where: { id: stored.id }, data: { revoked: true, revokedAt: new Date() } });

  const remainingMs = Math.max(0, new Date(stored.expiresAt).getTime() - Date.now());
  if (remainingMs <= 0) throw new AppError('Session is no longer valid', 401);

  const newSession = await prisma.platformAdminSession.create({
    data: {
      platformAdminId: admin.id,
      tokenHash: 'pending',
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
      mfaVerified: stored.mfaVerified,
      authenticatedAt: stored.authenticatedAt,
      // Refreshing rotates the credential but does NOT extend the absolute
      // session lifetime configured by platform security settings.
      expiresAt: stored.expiresAt,
    },
  });
  const newRefreshToken = signPlatformRefreshToken(admin, newSession, Math.ceil(remainingMs / 1000));
  const finalSession = await prisma.platformAdminSession.update({
    where: { id: newSession.id },
    data: { tokenHash: hashPlatformToken(newRefreshToken) },
  });
  const accessToken = signPlatformAccessToken(admin, finalSession);

  res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, refreshCookieOptions(remainingMs));
  res.json({ success: true, data: { admin: sanitizeAdmin(admin), accessToken } });
});

const logout = catchAsync(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
  if (token) {
    await prisma.platformAdminSession
      .updateMany({ where: { tokenHash: hashPlatformToken(token) }, data: { revoked: true, revokedAt: new Date() } })
      .catch(() => {});
  }
  if (req.platformAdmin) {
    await recordPlatformAudit(req, {
      action: 'LOGOUT',
      entityType: 'PlatformAdmin',
      entityId: req.platformAdmin.id,
      description: `${req.platformAdmin.email} logged out`,
    });
  }
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  res.json({ success: true, message: 'Logged out' });
});

// "Logout from all sessions" — revokes every session for the current
// admin, including the one making this request (matches the spirit of
// "log me out everywhere", e.g. after a suspected compromise).
const logoutAllSessions = catchAsync(async (req, res) => {
  await prisma.platformAdminSession.updateMany({
    where: { platformAdminId: req.platformAdmin.id, revoked: false },
    data: { revoked: true, revokedAt: new Date() },
  });
  await recordPlatformAudit(req, {
    action: 'SESSION_REVOKED',
    entityType: 'PlatformAdmin',
    entityId: req.platformAdmin.id,
    description: `${req.platformAdmin.email} revoked all sessions`,
  });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  res.json({ success: true, message: 'All sessions revoked. Please sign in again.' });
});

const me = catchAsync(async (req, res) => {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin.id } });
  if (!admin) throw new AppError('Platform admin no longer exists', 401);
  res.json({
    success: true,
    data: { ...sanitizeAdmin(admin), session: req.platformSession },
  });
});

const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin.id } });
  if (!admin) throw new AppError('Platform admin no longer exists', 401);

  const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!valid) throw new AppError('Current password is incorrect', 401);

  const settings = await getSecuritySettings();
  assertPasswordMeetsPolicy(newPassword, settings);

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const currentSessionId = req.platformSession.id;

  await prisma.$transaction([
    // Clears any SUPER_ADMIN-imposed forced-reset flag (see
    // requireMustChangePassword) — this endpoint is precisely how an
    // admin satisfies it.
    prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordHash, mustChangePassword: false } }),
    // Revoke every OTHER session — same "kick out other devices" pattern
    // as the community side's changePassword.
    prisma.platformAdminSession.updateMany({
      where: { platformAdminId: admin.id, revoked: false, id: { not: currentSessionId } },
      data: { revoked: true, revokedAt: new Date() },
    }),
  ]);

  await recordPlatformAudit(req, {
    action: 'PASSWORD_CHANGED',
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    description: `${admin.email} changed their password`,
  });

  res.json({ success: true, message: 'Password updated' });
});

// --- MFA enrollment/verification/recovery ---

const mfaEnrollStart = catchAsync(async (req, res) => {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin.id } });
  if (admin.mfaEnabled) throw new AppError('MFA is already enabled on this account', 409);

  const secret = generateTotpSecret();
  await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: { mfaSecretEnc: encryptMfaSecret(secret) },
  });

  res.json({
    success: true,
    data: {
      secret,
      otpAuthUrl: buildOtpAuthUrl({ secret, accountEmail: admin.email }),
    },
  });
});

const mfaEnrollVerify = catchAsync(async (req, res) => {
  const { token } = req.body;
  const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin.id } });
  if (admin.mfaEnabled) throw new AppError('MFA is already enabled on this account', 409);
  if (!admin.mfaSecretEnc) throw new AppError('Start MFA enrollment first', 400);

  const secret = decryptMfaSecret(admin.mfaSecretEnc);
  if (!verifyTotp(secret, token)) throw new AppError('Invalid authentication code', 401);

  const recoveryCodes = generateRecoveryCodes();
  const hashes = recoveryCodes.map(hashRecoveryCode);

  await prisma.platformAdmin.update({
    where: { id: admin.id },
    // Also clears any SUPER_ADMIN-imposed forced-reenrollment flag (see
    // requireMfa / platformAdminManagementController.requireMfaReenrollment)
    // — completing enrollment is precisely how an admin satisfies it.
    data: { mfaEnabled: true, mfaEnrolledAt: new Date(), mfaRecoveryCodeHashes: hashes, mfaReenrollmentRequired: false },
  });
  // The session that just enrolled MFA is treated as MFA-verified going
  // forward, so the admin isn't immediately blocked by requireMfa.
  await prisma.platformAdminSession.update({
    where: { id: req.platformSession.id },
    data: { mfaVerified: true },
  });

  await recordPlatformAudit(req, {
    action: 'MFA_ENABLED',
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    description: `${admin.email} enabled MFA`,
  });

  res.json({
    success: true,
    message: 'MFA enabled',
    data: { recoveryCodes }, // shown exactly once — only hashes are persisted
  });
});

const mfaDisable = catchAsync(async (req, res) => {
  const { password, token } = req.body;
  const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin.id } });
  if (!admin.mfaEnabled) throw new AppError('MFA is not enabled on this account', 400);
  if (isMfaMandatoryForRole(admin.role)) {
    throw new AppError('MFA cannot be disabled for this role', 403);
  }

  const validPassword = await bcrypt.compare(password, admin.passwordHash);
  if (!validPassword) throw new AppError('Incorrect password', 401);

  const secret = decryptMfaSecret(admin.mfaSecretEnc);
  if (!verifyTotp(secret, token)) throw new AppError('Invalid authentication code', 401);

  await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: { mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryCodeHashes: [], mfaEnrolledAt: null },
  });

  await recordPlatformAudit(req, {
    action: 'MFA_DISABLED',
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    description: `${admin.email} disabled MFA`,
  });

  res.json({ success: true, message: 'MFA disabled' });
});

module.exports = {
  login,
  refresh,
  logout,
  logoutAllSessions,
  me,
  changePassword,
  mfaEnrollStart,
  mfaEnrollVerify,
  mfaDisable,
};
