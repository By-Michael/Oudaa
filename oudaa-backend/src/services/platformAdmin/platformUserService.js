'use strict';

const prisma = require('../../config/prisma');

/**
 * Global user directory — crosses tenant boundaries (platform admin only).
 * Never returns passwords, hashes, tokens, or MFA secrets.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const SAFE_USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  communityId: true,
  createdAt: true,
  updatedAt: true,
  avatarUrl: true,
  // Intentionally excluded: passwordHash, avatarStorageKey, preferences
  community: {
    select: { id: true, name: true, slug: true, status: true },
  },
  resident: {
    select: {
      id: true,
      status: true,
      unitNumber: true,
      inactiveReason: true,
    },
  },
  // Most recent active session for "last login"
  refreshTokens: {
    where: { revoked: false, expiresAt: { gt: new Date() } },
    select: { createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
};

/**
 * Platform-wide paginated user search.
 */
async function listUsers(opts = {}) {
  const {
    search,
    communityId,
    role,
    residentStatus,
    createdAfter,
    createdBefore,
    hasActivity, // 'active' | 'inactive' | 'all'
    sortBy = 'createdAt',
    sortDir = 'desc',
    page = 1,
    pageSize: rawPs,
  } = opts;

  const pageSize = Math.min(Math.max(parseInt(rawPs, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * pageSize;

  const where = {};

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { fullName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }

  if (communityId && communityId !== 'all') {
    where.communityId = communityId;
  }

  if (role && role !== 'all') {
    where.role = role.toUpperCase();
  }

  if (residentStatus && residentStatus !== 'all') {
    where.resident = { status: residentStatus.toUpperCase() };
  }

  if (createdAfter || createdBefore) {
    where.createdAt = {};
    if (createdAfter) where.createdAt.gte = new Date(createdAfter);
    if (createdBefore) where.createdAt.lte = new Date(createdBefore);
  }

  const allowedSortFields = ['fullName', 'email', 'role', 'createdAt', 'updatedAt'];
  const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const safeSortDir = sortDir === 'asc' ? 'asc' : 'desc';

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { [safeSortBy]: safeSortDir },
      skip,
      take: pageSize,
      select: SAFE_USER_SELECT,
    }),
  ]);

  const formatted = users.map(formatUser);

  return {
    data: formatted,
    pagination: {
      page: parseInt(page, 10) || 1,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

/**
 * Full user detail for /users/:id — safe subset only.
 */
async function getUserDetail(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...SAFE_USER_SELECT,
      // Active sessions count + recency (for security view)
      refreshTokens: {
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          revoked: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });

  if (!user) return null;

  // Audit history (community-side, last 50)
  const auditHistory = await prisma.auditLog.findMany({
    where: { actorId: userId, communityId: user.communityId ?? undefined },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      description: true,
      createdAt: true,
    },
  });

  const activeSessions = user.refreshTokens.filter(
    (t) => !t.revoked && new Date(t.expiresAt) > new Date()
  );

  return {
    ...formatUser(user),
    sessions: {
      active: activeSessions.length,
      total: user.refreshTokens.length,
      list: user.refreshTokens.map((t) => ({
        id: t.id,
        lastUsedAt: null,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
        revoked: t.revoked,
        active: !t.revoked && new Date(t.expiresAt) > new Date(),
      })),
    },
    auditHistory,
  };
}

/**
 * Disable a community user account by revoking all refresh tokens.
 * We do NOT delete the user — just revoke sessions so they are immediately
 * signed out. Their record + data remains intact.
 */
async function revokeUserSessions(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true },
  });
}

/**
 * Shared safe formatter — never returns secrets.
 */
function formatUser(u) {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    communityId: u.communityId,
    community: u.community
      ? { id: u.community.id, name: u.community.name, slug: u.community.slug, status: u.community.status }
      : null,
    residentProfile: u.resident
      ? {
          id: u.resident.id,
          status: u.resident.status,
          unitNumber: u.resident.unitNumber,
          inactiveReason: u.resident.inactiveReason ?? null,
        }
      : null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    avatarUrl: u.avatarUrl ?? null,
    lastActivity: u.refreshTokens?.[0]?.createdAt ?? null,
    // Explicitly never included: passwordHash, mfaSecretEnc, refreshToken hashes
  };
}

module.exports = { listUsers, getUserDetail, revokeUserSessions };
