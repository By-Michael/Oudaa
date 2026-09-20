'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { canRoleGrantRole, ASSIGNABLE_ROLES, getPermissionsForRole } = require('../../config/platformPermissions');
const { assertPasswordMeetsPolicy } = require('../../utils/passwordPolicy');
const { getSecuritySettings } = require('./platformSecuritySettingsService');

function sanitizeAdmin(admin) {
  const { passwordHash, mfaSecretEnc, mfaRecoveryCodeHashes, ...safe } = admin;
  return safe;
}

async function listAdmins({ search, role, status, page = 1, pageSize = 25 } = {}) {
  const take = Math.min(Number(pageSize) || 25, 100);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  const where = {};
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (role) where.role = role;
  if (status === 'active') where.isActive = true;
  if (status === 'disabled') where.isActive = false;

  const [total, admins] = await Promise.all([
    prisma.platformAdmin.count({ where }),
    prisma.platformAdmin.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  return {
    data: admins.map(sanitizeAdmin),
    pagination: { total, page: Math.max(Number(page) || 1, 1), pageSize: take, pageCount: Math.ceil(total / take) || 1 },
  };
}

async function getAdminDetail(id) {
  const admin = await prisma.platformAdmin.findUnique({ where: { id } });
  if (!admin) return null;

  const [activeSessions, recentActivity] = await Promise.all([
    prisma.platformAdminSession.count({ where: { platformAdminId: id, revoked: false, expiresAt: { gt: new Date() } } }),
    prisma.platformAuditLog.findMany({
      where: { actorId: id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  return {
    ...sanitizeAdmin(admin),
    activeSessionCount: activeSessions,
    recentActivity,
  };
}

async function createAdmin({ fullName, email, password, role }, actor) {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new AppError('Unknown role', 400);
  }
  // Self-escalation guard: you can only create an admin with a role whose
  // permissions are a subset of your own. A PLATFORM_ADMIN, for instance,
  // could never spin up a new SUPER_ADMIN account this way.
  if (!canRoleGrantRole(actor.role, role)) {
    throw new AppError('You cannot create an admin with a role that grants permissions you do not have', 403);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.platformAdmin.findUnique({ where: { email: normalizedEmail } });
  if (existing) throw new AppError('An admin with this email already exists', 409);

  const settings = await getSecuritySettings();
  assertPasswordMeetsPolicy(password, settings);

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.platformAdmin.create({
    data: { fullName: fullName.trim(), email: normalizedEmail, passwordHash, role },
  });
  return sanitizeAdmin(admin);
}

async function setActiveStatus(targetId, isActive, actor) {
  if (targetId === actor.id) {
    throw new AppError('You cannot enable or disable your own account', 403);
  }
  const target = await prisma.platformAdmin.findUnique({ where: { id: targetId } });
  if (!target) throw new AppError('Platform admin not found', 404);

  const updated = await prisma.platformAdmin.update({
    where: { id: targetId },
    data: { isActive },
  });

  if (!isActive) {
    // Disabling an operator must take effect immediately, not just block
    // future logins — kill every live session server-side right now.
    await prisma.platformAdminSession.updateMany({
      where: { platformAdminId: targetId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });
  }

  return sanitizeAdmin(updated);
}

async function changeRole(targetId, newRole, actor) {
  if (targetId === actor.id) {
    throw new AppError('You cannot change your own role', 403, { code: 'SELF_ESCALATION_BLOCKED' });
  }
  if (!ASSIGNABLE_ROLES.includes(newRole)) {
    throw new AppError('Unknown role', 400);
  }
  const target = await prisma.platformAdmin.findUnique({ where: { id: targetId } });
  if (!target) throw new AppError('Platform admin not found', 404);

  // Core self-escalation rule: an operator must not be able to grant a
  // role — to anyone, including themselves, though that path is already
  // blocked above — that carries permissions they do not themselves
  // possess. SUPER_ADMIN's ALL_PERMISSIONS superset always passes.
  if (!canRoleGrantRole(actor.role, newRole)) {
    const err = new AppError('You cannot assign a role that grants permissions you do not have', 403, {
      code: 'SELF_ESCALATION_BLOCKED',
    });
    err.deniedRole = newRole;
    throw err;
  }

  const updated = await prisma.platformAdmin.update({
    where: { id: targetId },
    data: { role: newRole },
  });
  return { previousRole: target.role, admin: sanitizeAdmin(updated) };
}

async function requirePasswordReset(targetId, actor) {
  if (targetId === actor.id) {
    throw new AppError('You cannot flag your own account for a forced password reset — sign out and change your password normally instead', 403);
  }
  const target = await prisma.platformAdmin.findUnique({ where: { id: targetId } });
  if (!target) throw new AppError('Platform admin not found', 404);

  const updated = await prisma.platformAdmin.update({
    where: { id: targetId },
    data: { mustChangePassword: true },
  });
  // A forced reset should also end any session the admin is currently
  // riding on with the old (potentially compromised) password — otherwise
  // requireMustChangePassword only bites on their NEXT request, and only
  // if that request hits a route that checks it.
  await prisma.platformAdminSession.updateMany({
    where: { platformAdminId: targetId, revoked: false },
    data: { revoked: true, revokedAt: new Date() },
  });
  return sanitizeAdmin(updated);
}

async function requireMfaReenrollment(targetId, actor) {
  if (targetId === actor.id) {
    throw new AppError('You cannot flag your own account for forced MFA re-enrollment — use MFA disable/re-enroll from your own account settings instead', 403);
  }
  const target = await prisma.platformAdmin.findUnique({ where: { id: targetId } });
  if (!target) throw new AppError('Platform admin not found', 404);

  const updated = await prisma.platformAdmin.update({
    where: { id: targetId },
    data: {
      mfaEnabled: false,
      mfaSecretEnc: null,
      mfaRecoveryCodeHashes: [],
      mfaEnrolledAt: null,
      mfaReenrollmentRequired: true,
    },
  });
  // Existing sessions must not keep riding on the OLD "mfaVerified: true"
  // claim now that the secret behind it has been wiped.
  await prisma.platformAdminSession.updateMany({
    where: { platformAdminId: targetId, revoked: false },
    data: { mfaVerified: false },
  });
  return sanitizeAdmin(updated);
}

async function revokeAdminSessions(targetId) {
  const target = await prisma.platformAdmin.findUnique({ where: { id: targetId } });
  if (!target) throw new AppError('Platform admin not found', 404);
  const result = await prisma.platformAdminSession.updateMany({
    where: { platformAdminId: targetId, revoked: false },
    data: { revoked: true, revokedAt: new Date() },
  });
  return { revokedCount: result.count };
}

module.exports = {
  sanitizeAdmin,
  listAdmins,
  getAdminDetail,
  createAdmin,
  setActiveStatus,
  changeRole,
  requirePasswordReset,
  requireMfaReenrollment,
  revokeAdminSessions,
  getPermissionsForRole,
};
