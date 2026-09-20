/**
 * Backend-driven global search across platform entities. Each category is
 * independently gated by the permission that already guards that
 * category's own module (see platformPermissions.js) — a role lacking
 * e.g. platform.support.view gets no `support` group in the results at
 * all, not an empty one (which would still leak "nothing matched" as
 * information). Every query is capped (PER_CATEGORY_LIMIT) and pushed
 * down to Postgres via `contains` filters — nothing is loaded in bulk
 * and filtered in Node.
 */
const prisma = require('../../config/prisma');
const { roleHasPermission, PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');

const PER_CATEGORY_LIMIT = 5;
const MIN_QUERY_LENGTH = 2;

async function searchCommunities(q) {
  const rows = await prisma.community.findMany({
    where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] },
    take: PER_CATEGORY_LIMIT,
    select: { id: true, name: true, slug: true, status: true },
  });
  return rows.map((c) => ({
    type: 'community',
    id: c.id,
    title: c.name,
    subtitle: `${c.slug} · ${c.status}`,
    link: `/platform-admin/communities/${c.id}`,
  }));
}

async function searchUsers(q) {
  const rows = await prisma.user.findMany({
    where: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
    take: PER_CATEGORY_LIMIT,
    select: { id: true, fullName: true, email: true, role: true, communityId: true },
  });
  return rows.map((u) => ({
    type: u.role === 'ADMIN' ? 'community_admin' : 'user',
    id: u.id,
    title: u.fullName,
    subtitle: `${u.email} · ${u.role}`,
    link: `/platform-admin/users/${u.id}`,
  }));
}

async function searchResidents(q) {
  const rows = await prisma.resident.findMany({
    where: {
      OR: [
        { user: { fullName: { contains: q, mode: 'insensitive' } } },
        { unitNumber: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: PER_CATEGORY_LIMIT,
    select: { id: true, unitNumber: true, status: true, user: { select: { fullName: true } } },
  });
  return rows.map((r) => ({
    type: 'resident',
    id: r.id,
    title: r.user?.fullName || 'Unknown resident',
    subtitle: `Unit ${r.unitNumber} · ${r.status}`,
    link: `/platform-admin/users/resident/${r.id}`,
  }));
}

async function searchSupport(q) {
  const rows = await prisma.supportChatSession.findMany({
    where: { title: { contains: q, mode: 'insensitive' } },
    take: PER_CATEGORY_LIMIT,
    select: { id: true, title: true, createdAt: true },
  });
  return rows.map((s) => ({
    type: 'support',
    id: s.id,
    title: s.title,
    subtitle: new Date(s.createdAt).toLocaleDateString(),
    link: `/platform-admin/support?sessionId=${s.id}`,
  }));
}

async function searchAudit(q) {
  const rows = await prisma.platformAuditLog.findMany({
    where: { OR: [{ action: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] },
    orderBy: { createdAt: 'desc' },
    take: PER_CATEGORY_LIMIT,
    select: { id: true, action: true, description: true, createdAt: true },
  });
  return rows.map((a) => ({
    type: 'audit',
    id: a.id,
    title: a.description,
    subtitle: `${a.action} · ${new Date(a.createdAt).toLocaleDateString()}`,
    link: `/platform-admin/audit?entryId=${a.id}`,
  }));
}

async function searchPayments(q) {
  const rows = await prisma.payment.findMany({
    where: {
      OR: [
        { transactionReference: { contains: q, mode: 'insensitive' } },
        { payerName: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: PER_CATEGORY_LIMIT,
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true, status: true, payerName: true, transactionReference: true, communityId: true },
  });
  return rows.map((p) => ({
    type: 'payment',
    id: p.id,
    title: p.transactionReference || `Payment from ${p.payerName || 'unknown'}`,
    subtitle: `${p.amount} · ${p.status}`,
    link: p.communityId ? `/platform-admin/communities/${p.communityId}?tab=payments&paymentId=${encodeURIComponent(p.id)}` : '/platform-admin/communities',
  }));
}

async function searchProjects(q) {
  const rows = await prisma.project.findMany({
    where: { name: { contains: q, mode: 'insensitive' } },
    take: PER_CATEGORY_LIMIT,
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, status: true, communityId: true },
  });
  return rows.map((p) => ({
    type: 'project',
    id: p.id,
    title: p.name,
    subtitle: p.status,
    link: p.communityId ? `/platform-admin/communities/${p.communityId}?tab=projects&projectId=${encodeURIComponent(p.id)}` : '/platform-admin/communities',
  }));
}

// [permission, category key, search fn]
const CATEGORY_MAP = [
  [PLATFORM_PERMISSIONS.COMMUNITIES_VIEW, 'communities', searchCommunities],
  [PLATFORM_PERMISSIONS.USERS_VIEW, 'users', searchUsers],
  [PLATFORM_PERMISSIONS.ADMINS_VIEW, 'admins', searchPlatformAdmins],
  [PLATFORM_PERMISSIONS.USERS_VIEW, 'residents', searchResidents],
  [PLATFORM_PERMISSIONS.SUPPORT_VIEW, 'support_tickets', searchSupportTickets],
  [PLATFORM_PERMISSIONS.AUDIT_VIEW, 'audit', searchAudit],
  [PLATFORM_PERMISSIONS.COMMUNITIES_VIEW, 'payments', searchPayments],
  [PLATFORM_PERMISSIONS.COMMUNITIES_VIEW, 'projects', searchProjects],
];

async function globalSearch(role, query) {
  const q = String(query || '').trim();
  if (q.length < MIN_QUERY_LENGTH) {
    return { query: q, groups: [], tooShort: true, minLength: MIN_QUERY_LENGTH };
  }

  const permitted = CATEGORY_MAP.filter(([permission]) => roleHasPermission(role, permission));
  const results = await Promise.all(permitted.map(([, , fn]) => fn(q)));

  const groups = permitted
    .map(([, key], i) => ({ category: key, results: results[i] }))
    .filter((g) => g.results.length > 0);

  return { query: q, groups, tooShort: false };
}

module.exports = { globalSearch };
