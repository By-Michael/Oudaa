/**
 * Aggregate queries backing the platform overview dashboard. Every number
 * here comes from a database aggregate (count/groupBy/sum) — never by
 * pulling rows into Node and counting them in JS — per Phase 2's explicit
 * performance requirement.
 *
 * A short in-memory cache (SUMMARY_CACHE_TTL_MS) smooths over a burst of
 * dashboard loads (e.g. several operators with the tab open, or one
 * operator refreshing) without needing a new caching dependency. It is
 * intentionally short and process-local — correctness for an operations
 * dashboard matters more than shaving a few queries, so this is a
 * "debounce", not a real cache layer; nothing here is ever served stale
 * across a deploy/restart, and every write-triggering admin action
 * happens through completely different, uncached routes.
 */
const prisma = require('../../config/prisma');

const SUMMARY_CACHE_TTL_MS = 15 * 1000;
let summaryCache = { value: null, expiresAt: 0 };

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysAgoUtc(days) {
  const start = startOfTodayUtc();
  start.setUTCDate(start.getUTCDate() - days);
  return start;
}

async function getCoreMetrics() {
  const today = startOfTodayUtc();

  const [
    totalCommunities,
    activeCommunities,
    suspendedCommunities,
    totalUsers,
    totalResidents,
    totalCommunityAdmins,
    activePlatformAdmins,
    communitiesCreatedToday,
    usersCreatedToday,
    activeCommunitySessions,
    activePlatformSessions,
    supportConversationsTotal,
    supportConversationsToday,
  ] = await Promise.all([
    prisma.community.count(),
    prisma.community.count({ where: { status: 'ACTIVE' } }),
    prisma.community.count({ where: { status: 'SUSPENDED' } }),
    prisma.user.count(),
    prisma.user.count({ where: { role: 'RESIDENT' } }),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.platformAdmin.count({ where: { isActive: true } }),
    prisma.community.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.refreshToken.count({ where: { revoked: false, expiresAt: { gt: new Date() } } }),
    prisma.platformAdminSession.count({ where: { revoked: false, expiresAt: { gt: new Date() } } }),
    prisma.supportChatSession.count(),
    prisma.supportChatSession.count({ where: { createdAt: { gte: today } } }),
  ]);

  return {
    communities: { total: totalCommunities, active: activeCommunities, suspended: suspendedCommunities, createdToday: communitiesCreatedToday },
    users: { total: totalUsers, residents: totalResidents, communityAdmins: totalCommunityAdmins, createdToday: usersCreatedToday },
    platformAdmins: { active: activePlatformAdmins },
    sessions: { activeCommunitySessions, activePlatformSessions },
    // NOTE: this codebase has no support-ticket/status model yet (see
    // SupportChatSession in prisma/schema.prisma) — only saved AI-assistant
    // conversations, with no open/closed/escalated concept. Reporting a
    // fabricated "open support items" count would violate Phase 2's "never
    // fabricate" instruction, so this is honestly labeled as conversation
    // counts instead. A real ticketing system is a prerequisite for a true
    // "open items" metric (tracked as a limitation).
    support: {
      conversationsTotal: supportConversationsTotal,
      conversationsToday: supportConversationsToday,
      ticketingConfigured: false,
    },
  };
}

async function getFinancialAggregates() {
  const [paymentsByStatus, totalPaymentAmount, fundCount, activeProjects, expenseAgg] = await Promise.all([
    prisma.payment.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.payment.aggregate({ _sum: { amount: true } }),
    prisma.fund.count(),
    prisma.project.count({ where: { status: 'ONGOING' } }),
    prisma.expense.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
  ]);
  const byStatus = { PENDING: 0, PENDING_REVIEW: 0, VERIFIED: 0, REJECTED: 0 };
  for (const row of paymentsByStatus) byStatus[row.status] = row._count._all;

  return {
    payments: {
      total: byStatus.PENDING + byStatus.PENDING_REVIEW + byStatus.VERIFIED + byStatus.REJECTED,
      verified: byStatus.VERIFIED,
      pending: byStatus.PENDING + byStatus.PENDING_REVIEW,
      rejected: byStatus.REJECTED,
      totalAmount: totalPaymentAmount._sum.amount || 0,
    },
    funds: { tracked: fundCount },
    projects: { active: activeProjects },
    expenses: { recorded: expenseAgg._count._all, totalAmount: expenseAgg._sum.amount || 0 },
    scope: 'platform-wide', // explicitly not a single-community view — see Phase 2 spec
  };
}

async function getSummary({ bypassCache = false } = {}) {
  if (!bypassCache && summaryCache.value && summaryCache.expiresAt > Date.now()) {
    return summaryCache.value;
  }

  const [metrics, financial] = await Promise.all([getCoreMetrics(), getFinancialAggregates()]);
  const value = { metrics, financial, generatedAt: new Date().toISOString() };

  summaryCache = { value, expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS };
  return value;
}

/**
 * Daily new-communities / new-users counts for the last `days` days,
 * via a single grouped aggregate per model (not one query per day). Only
 * as many days back as data actually exists — a platform younger than
 * `days` days simply gets fewer points, communicated via `earliestDataAt`
 * rather than fabricating flat zeroed history before the platform existed.
 */
async function getGrowthChart(days = 30) {
  const since = daysAgoUtc(days - 1);

  const [communities, users, earliestCommunity] = await Promise.all([
    prisma.$queryRaw`
      SELECT DATE("createdAt") AS day, COUNT(*)::int AS count
      FROM "communities"
      WHERE "createdAt" >= ${since}
      GROUP BY DATE("createdAt")
      ORDER BY day ASC
    `,
    prisma.$queryRaw`
      SELECT DATE("createdAt") AS day, COUNT(*)::int AS count
      FROM "users"
      WHERE "createdAt" >= ${since}
      GROUP BY DATE("createdAt")
      ORDER BY day ASC
    `,
    prisma.community.aggregate({ _min: { createdAt: true } }),
  ]);

  return {
    since: since.toISOString(),
    newCommunities: communities.map((r) => ({ date: r.day, count: r.count })),
    newUsers: users.map((r) => ({ date: r.day, count: r.count })),
    earliestDataAt: earliestCommunity._min.createdAt,
    // Requests/errors time series has no honest source in this codebase —
    // there is no request-logging/APM table (see limitations). Rather
    // than fabricate a "platform activity" chart, that series is simply
    // omitted; the frontend shows an explicit "not available" state for
    // it instead of a chart with invented numbers.
    requestActivityAvailable: false,
  };
}

/**
 * Daily payment-submission / verified / pending counts for the last
 * `days` days — same single-grouped-query approach as getGrowthChart.
 */
async function getFinancialActivityChart(days = 30) {
  const since = daysAgoUtc(days - 1);

  // Payment has no createdAt/updatedAt column — paidAt is both "when
  // recorded" and "when it counts as submitted" for self-verified
  // payments (see Payment.paidAt in prisma/schema.prisma), so it's the
  // correct column for a submissions-over-time chart.
  const rows = await prisma.$queryRaw`
    SELECT DATE("paidAt") AS day,
           COUNT(*)::int AS submitted,
           COUNT(*) FILTER (WHERE status = 'VERIFIED')::int AS verified,
           COUNT(*) FILTER (WHERE status IN ('PENDING', 'PENDING_REVIEW'))::int AS pending
    FROM "payments"
    WHERE "paidAt" >= ${since}
    GROUP BY DATE("paidAt")
    ORDER BY day ASC
  `;

  return {
    since: since.toISOString(),
    series: rows.map((r) => ({ date: r.day, submitted: r.submitted, verified: r.verified, pending: r.pending })),
  };
}

module.exports = {
  getSummary,
  getGrowthChart,
  getFinancialActivityChart,
};
