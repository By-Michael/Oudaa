'use strict';

const prisma = require('../../config/prisma');
const {
  PLATFORM_AUDIT_ACTIONS,
  PRIVILEGED_ACTIONS,
  UNUSUAL_LOGIN_REASONS,
  SECURITY_EVENT_CATEGORIES,
} = require('../../config/platformSecurityEvents');

function sanitizeSession(session) {
  // tokenHash is a hash, not a secret in the reversible sense, but there
  // is still no legitimate reason for the API to ever return it.
  const { tokenHash, ...safe } = session;
  return safe;
}

/**
 * GET /security overview — everything the spec's "Authentication
 * security" panel asks for, computed from real rows (PlatformAdmin +
 * PlatformAdminSession + PlatformAuditLog), not placeholders.
 */
async function getDashboardOverview({ windowHours = 24 } = {}) {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const now = new Date();

  const [
    failedLogins,
    successfulLogins,
    unusualLoginEvents,
    lockedAccounts,
    activeSessions,
    revokedSessionsInWindow,
    totalAdmins,
    mfaEnabledCount,
    adminsByRole,
    recentPrivilegedOperations,
  ] = await Promise.all([
    prisma.platformAuditLog.count({ where: { action: PLATFORM_AUDIT_ACTIONS.LOGIN_FAILED, createdAt: { gte: since } } }),
    prisma.platformAuditLog.count({ where: { action: PLATFORM_AUDIT_ACTIONS.LOGIN_SUCCESS, createdAt: { gte: since } } }),
    prisma.platformAuditLog.findMany({
      where: {
        action: PLATFORM_AUDIT_ACTIONS.LOGIN_FAILED,
        createdAt: { gte: since },
        OR: UNUSUAL_LOGIN_REASONS.map((reason) => ({ metadata: { path: ['reason'], equals: reason } })),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.platformAdmin.count({ where: { lockedUntil: { gt: now } } }),
    prisma.platformAdminSession.count({ where: { revoked: false, expiresAt: { gt: now } } }),
    prisma.platformAdminSession.count({ where: { revoked: true, revokedAt: { gte: since } } }),
    prisma.platformAdmin.count(),
    prisma.platformAdmin.count({ where: { mfaEnabled: true } }),
    prisma.platformAdmin.groupBy({ by: ['role'], _count: { _all: true }, where: {} }),
    prisma.platformAuditLog.findMany({
      where: { action: { in: PRIVILEGED_ACTIONS } },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  const mfaEnabledByRole = await prisma.platformAdmin.groupBy({
    by: ['role'],
    _count: { _all: true },
    where: { mfaEnabled: true },
  });
  const mfaByRoleMap = Object.fromEntries(mfaEnabledByRole.map((r) => [r.role, r._count._all]));

  return {
    windowHours,
    authentication: {
      failedLogins,
      successfulLogins,
      suspiciousLoginEvents: unusualLoginEvents.length,
      lockedAccounts,
      activeSessions,
      revokedSessions: revokedSessionsInWindow,
    },
    suspiciousEvents: unusualLoginEvents.map((e) => ({
      id: e.id,
      description: e.description,
      attemptedEmail: e.actorEmail,
      reason: e.metadata?.reason || null,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt,
    })),
    mfa: {
      totalAdmins,
      mfaEnabledCount,
      adoptionPercent: totalAdmins ? Math.round((mfaEnabledCount / totalAdmins) * 100) : 0,
      byRole: adminsByRole.map((r) => ({
        role: r.role,
        total: r._count._all,
        mfaEnabled: mfaByRoleMap[r.role] || 0,
      })),
    },
    recentPrivilegedOperations: recentPrivilegedOperations.map((op) => ({
      id: op.id,
      action: op.action,
      actorEmail: op.actorEmail,
      actorRole: op.actorRole,
      description: op.description,
      success: op.success,
      createdAt: op.createdAt,
    })),
  };
}

/**
 * GET /security/events — filterable security event feed. `categories` is
 * an array of keys from SECURITY_EVENT_CATEGORIES (see
 * config/platformSecurityEvents.js); omitted means "all categories".
 */
async function listSecurityEvents({ categories, from, to, page = 1, pageSize = 50 } = {}) {
  const take = Math.min(Number(pageSize) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  const selectedCategories = (Array.isArray(categories) ? categories : categories ? [categories] : [])
    .filter((c) => SECURITY_EVENT_CATEGORIES[c]);

  const orConditions = selectedCategories.length
    ? selectedCategories.map((c) => SECURITY_EVENT_CATEGORIES[c].where)
    : Object.values(SECURITY_EVENT_CATEGORIES).map((c) => c.where);

  const where = { OR: orConditions };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [total, events] = await Promise.all([
    prisma.platformAuditLog.count({ where }),
    prisma.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  return {
    data: events,
    pagination: { total, page: Math.max(Number(page) || 1, 1), pageSize: take, pageCount: Math.ceil(total / take) || 1 },
  };
}

/**
 * GET /security/sessions — every platform-admin session, most recent
 * first, with enough admin identity to render the table without a
 * separate lookup per row.
 */
async function listSessions({ adminId, status, page = 1, pageSize = 50 } = {}) {
  const take = Math.min(Number(pageSize) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const now = new Date();

  const where = {};
  if (adminId) where.platformAdminId = adminId;
  if (status === 'active') {
    where.revoked = false;
    where.expiresAt = { gt: now };
  } else if (status === 'revoked') {
    where.revoked = true;
  } else if (status === 'expired') {
    where.revoked = false;
    where.expiresAt = { lte: now };
  }

  const [total, sessions] = await Promise.all([
    prisma.platformAdminSession.count({ where }),
    prisma.platformAdminSession.findMany({
      where,
      orderBy: { lastUsedAt: 'desc' },
      skip,
      take,
      include: { platformAdmin: { select: { id: true, fullName: true, email: true, role: true } } },
    }),
  ]);

  const data = sessions.map((s) => {
    const { platformAdmin, ...rest } = sanitizeSession(s);
    let status2;
    if (rest.revoked) status2 = 'revoked';
    else if (rest.expiresAt <= now) status2 = 'expired';
    else status2 = 'active';
    return { ...rest, status: status2, admin: platformAdmin };
  });

  return {
    data,
    pagination: { total, page: Math.max(Number(page) || 1, 1), pageSize: take, pageCount: Math.ceil(total / take) || 1 },
  };
}

/**
 * Revoke one specific session server-side. Idempotent — revoking an
 * already-revoked session is a no-op success, not an error, so a slow
 * double-click in the UI doesn't surface a scary failure.
 */
async function revokeSessionById(sessionId) {
  const session = await prisma.platformAdminSession.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  if (session.revoked) return session;
  return prisma.platformAdminSession.update({
    where: { id: sessionId },
    data: { revoked: true, revokedAt: new Date() },
  });
}

module.exports = {
  getDashboardOverview,
  listSecurityEvents,
  listSessions,
  revokeSessionById,
};
