'use strict';

const prisma = require('../../config/prisma');

/**
 * Server-side paginated community directory with aggregated counts.
 * Never loads all communities into memory — every query uses LIMIT/OFFSET
 * with indexed WHERE conditions.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

// Milliseconds of inactivity that make a community "inactive" for the
// activity filter — 30 days is a reasonable operational definition.
const INACTIVE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Returns a paginated list of communities with per-community aggregate counts
 * (residents, admins, payments, projects, support sessions).
 *
 * @param {Object} opts
 * @param {string}   [opts.search]       – name/slug substring (case-insensitive)
 * @param {string}   [opts.status]       – CommunityStatus enum value or 'all'
 * @param {string}   [opts.activityFilter] – 'active_30d' | 'inactive_30d' | 'all'
 * @param {string}   [opts.createdAfter]  – ISO date string
 * @param {string}   [opts.createdBefore] – ISO date string
 * @param {string}   [opts.sortBy]       – field name
 * @param {string}   [opts.sortDir]      – 'asc' | 'desc'
 * @param {number}   [opts.page]         – 1-based
 * @param {number}   [opts.pageSize]
 */
async function listCommunities(opts = {}) {
  const {
    search,
    status,
    activityFilter,
    createdAfter,
    createdBefore,
    sortBy = 'createdAt',
    sortDir = 'desc',
    page = 1,
    pageSize: rawPageSize,
  } = opts;

  const pageSize = Math.min(Math.max(parseInt(rawPageSize, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * pageSize;

  // Build WHERE clause
  const where = {};

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q, mode: 'insensitive' } },
    ];
  }

  if (status && status !== 'all') {
    where.status = status.toUpperCase();
  }

  if (createdAfter || createdBefore) {
    where.createdAt = {};
    if (createdAfter) where.createdAt.gte = new Date(createdAfter);
    if (createdBefore) where.createdAt.lte = new Date(createdBefore);
  }

  // Activity filter: based on AuditLog entries in the community's own log
  // (reuses the existing community-side audit table — most recent action in
  // the last 30 days = "active"). Applied post-query because Prisma doesn't
  // support subquery-based WHERE on aggregate timestamps directly; we pull
  // the lastActivity field and filter here. This is acceptable at typical
  // community counts — for 10k+ communities use a materialized column.
  const activityFilterActive =
    activityFilter && activityFilter !== 'all' ? activityFilter : null;

  // ORDER BY — only columns that exist directly on Community
  const allowedSortFields = ['name', 'slug', 'status', 'createdAt', 'updatedAt'];
  const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const safeSortDir = sortDir === 'asc' ? 'asc' : 'desc';

  // Run count + data in parallel
  const [total, rawCommunities] = await Promise.all([
    prisma.community.count({ where }),
    prisma.community.findMany({
      where,
      orderBy: { [safeSortBy]: safeSortDir },
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        address: true,
        contactInfo: true,
        _count: {
          select: {
            users: true,
            residents: true,
            payments: true,
            projects: true,
            supportChatMessages: true,
          },
        },
      },
    }),
  ]);

  // Attach admin counts and last-activity separately (users with role=ADMIN)
  const communityIds = rawCommunities.map((c) => c.id);

  const [adminCounts, lastActivities] = await Promise.all([
    // Admins = users with role ADMIN per community
    prisma.user.groupBy({
      by: ['communityId'],
      where: { communityId: { in: communityIds }, role: 'ADMIN' },
      _count: { id: true },
    }),
    // Last audit log entry per community (proxy for last activity)
    prisma.auditLog.groupBy({
      by: ['communityId'],
      where: { communityId: { in: communityIds } },
      _max: { createdAt: true },
    }),
  ]);

  const adminCountMap = Object.fromEntries(
    adminCounts.map((r) => [r.communityId, r._count.id])
  );
  const lastActivityMap = Object.fromEntries(
    lastActivities.map((r) => [r.communityId, r._max.createdAt])
  );

  let communities = rawCommunities.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    address: c.address,
    contactInfo: c.contactInfo,
    residents: c._count.residents,
    admins: adminCountMap[c.id] ?? 0,
    payments: c._count.payments,
    projects: c._count.projects,
    supportMessages: c._count.supportChatMessages,
    lastActivity: lastActivityMap[c.id] ?? null,
  }));

  // Apply activity filter after join
  if (activityFilterActive) {
    const threshold = new Date(Date.now() - INACTIVE_THRESHOLD_MS);
    if (activityFilterActive === 'active_30d') {
      communities = communities.filter(
        (c) => c.lastActivity && new Date(c.lastActivity) >= threshold
      );
    } else if (activityFilterActive === 'inactive_30d') {
      communities = communities.filter(
        (c) => !c.lastActivity || new Date(c.lastActivity) < threshold
      );
    }
  }

  return {
    data: communities,
    pagination: {
      page: parseInt(page, 10) || 1,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

/**
 * Full community detail for the /communities/:id view.
 */
async function getCommunityDetail(communityId) {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      address: true,
      contactInfo: true,
      suspendedAt: true,
      suspendedReason: true,
      createdAt: true,
      updatedAt: true,
      paymentBankName: true,
      paymentAccountName: true,
      paymentAccountNumber: true,
      autoVerifyMaxAmount: true,
      _count: {
        select: {
          users: true,
          residents: true,
          payments: true,
          projects: true,
          expenses: true,
          funds: true,
          supportChatMessages: true,
          auditLogs: true,
        },
      },
    },
  });

  if (!community) return null;

  // Parallelise the heavier aggregates
  const [
    adminCount,
    paymentStats,
    projectStats,
    lastActivity,
    paymentMethods,
    recentAudit,
  ] = await Promise.all([
    prisma.user.count({ where: { communityId, role: 'ADMIN' } }),

    // Pending / pending-review payment counts
    prisma.payment.groupBy({
      by: ['status'],
      where: { communityId },
      _count: { id: true },
    }),

    // Project breakdown
    prisma.project.groupBy({
      by: ['status'],
      where: { communityId },
      _count: { id: true },
    }),

    // Last audit entry in this community
    prisma.auditLog.findFirst({
      where: { communityId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, action: true, entityType: true },
    }),

    // Payment methods configured
    prisma.communityPaymentMethod.findMany({
      where: { communityId },
      select: { id: true, provider: true, label: true },
    }),

    // 10 most recent audit entries for the Overview timeline
    prisma.auditLog.findMany({
      where: { communityId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        action: true,
        entityType: true,
        actorName: true,
        actorRole: true,
        description: true,
        createdAt: true,
      },
    }),
  ]);

  const paymentStatusMap = Object.fromEntries(
    paymentStats.map((r) => [r.status, r._count.id])
  );
  const projectStatusMap = Object.fromEntries(
    projectStats.map((r) => [r.status, r._count.id])
  );

  return {
    id: community.id,
    name: community.name,
    slug: community.slug,
    status: community.status,
    address: community.address,
    contactInfo: community.contactInfo,
    suspendedAt: community.suspendedAt,
    suspendedReason: community.suspendedReason,
    createdAt: community.createdAt,
    updatedAt: community.updatedAt,
    paymentConfig: {
      bankName: community.paymentBankName,
      accountName: community.paymentAccountName,
      accountNumber: community.paymentAccountNumber,
      autoVerifyMaxAmount: community.autoVerifyMaxAmount,
      methods: paymentMethods,
    },
    counts: {
      users: community._count.users,
      residents: community._count.residents,
      admins: adminCount,
      payments: community._count.payments,
      projects: community._count.projects,
      expenses: community._count.expenses,
      funds: community._count.funds,
      supportMessages: community._count.supportChatMessages,
      auditLogs: community._count.auditLogs,
    },
    diagnostics: {
      pendingPayments: paymentStatusMap['PENDING'] ?? 0,
      pendingReviewPayments: paymentStatusMap['PENDING_REVIEW'] ?? 0,
      activeProjects: projectStatusMap['ONGOING'] ?? 0,
      plannedProjects: projectStatusMap['PLANNED'] ?? 0,
      paymentMethodConfigured: paymentMethods.length > 0,
      lastActivity: lastActivity?.createdAt ?? null,
    },
    projectBreakdown: projectStatusMap,
    paymentBreakdown: paymentStatusMap,
    recentActivity: recentAudit,
  };
}

/**
 * Paginated list of community users (both ADMIN and RESIDENT).
 */
async function getCommunityUsers(communityId, opts = {}) {
  const { role, status, page = 1, pageSize: rawPs } = opts;
  const pageSize = Math.min(Math.max(parseInt(rawPs, 10) || 25, 1), 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * pageSize;

  const where = { communityId };
  if (role && role !== 'all') where.role = role.toUpperCase();

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        resident: {
          select: {
            id: true,
            status: true,
            unitNumber: true,
          },
        },
        refreshTokens: {
          where: { revoked: false, expiresAt: { gt: new Date() } },
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    }),
  ]);

  const formatted = users.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    residentStatus: u.resident?.status ?? null,
    unitNumber: u.resident?.unitNumber ?? null,
    lastActivity: u.refreshTokens[0]?.createdAt ?? null,
  }));

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
 * Set community status (suspend / reactivate).
 * Only platform admins may call this — verified by the route middleware.
 */
async function setCommunityStatus(communityId, newStatus, reason) {
  const data = { status: newStatus };
  if (newStatus === 'SUSPENDED') {
    data.suspendedAt = new Date();
    data.suspendedReason = reason ?? null;
  } else if (newStatus === 'ACTIVE') {
    data.suspendedAt = null;
    data.suspendedReason = null;
  }

  return prisma.community.update({
    where: { id: communityId },
    data,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      suspendedAt: true,
      suspendedReason: true,
    },
  });
}


async function revokeCommunityAdminSessions(communityId) {
  const admins = await prisma.user.findMany({ where: { communityId, role: 'ADMIN' }, select: { id: true } });
  if (!admins.length) return { affectedUsers: 0, revokedSessions: 0 };
  const result = await prisma.refreshToken.updateMany({
    where: { userId: { in: admins.map((a) => a.id) }, revoked: false },
    data: { revoked: true },
  });
  return { affectedUsers: admins.length, revokedSessions: result.count };
}

async function getOperationalWarnings(communityId) {
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { id: true, status: true, paymentBankName: true, paymentAccountNumber: true } });
  if (!community) return null;
  const [pendingReview, activeMethods, adminCount] = await Promise.all([
    prisma.payment.count({ where: { communityId, status: 'PENDING_REVIEW' } }),
    prisma.communityPaymentMethod.count({ where: { communityId, isActive: true } }),
    prisma.user.count({ where: { communityId, role: 'ADMIN' } }),
  ]);
  const warnings = [];
  if (community.status === 'SUSPENDED') warnings.push({ code: 'COMMUNITY_SUSPENDED', severity: 'HIGH', message: 'Community is suspended.' });
  if (pendingReview > 0) warnings.push({ code: 'PAYMENTS_PENDING_REVIEW', severity: 'MEDIUM', message: `${pendingReview} payment(s) require review.` });
  if (activeMethods === 0 && !community.paymentBankName && !community.paymentAccountNumber) warnings.push({ code: 'PAYMENT_CONFIGURATION_MISSING', severity: 'MEDIUM', message: 'No active payment method or fallback bank account is configured.' });
  if (adminCount === 0) warnings.push({ code: 'NO_COMMUNITY_ADMIN', severity: 'HIGH', message: 'Community has no committee administrator.' });
  return warnings;
}

module.exports = {
  listCommunities,
  getCommunityDetail,
  getCommunityUsers,
  setCommunityStatus,
  revokeCommunityAdminSessions,
  getOperationalWarnings,
};
