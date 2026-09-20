/**
 * Platform-level visibility into the AI support assistant (Phase 4).
 * Reuses supportAiAssistant.js's own config (SUPPORT_MODEL,
 * SUPPORT_MODEL_CHAIN, isConfigured) rather than re-deriving it, so this
 * can never drift from what the assistant actually does at request time
 * — same principle as platformHealthService's aiSupport check (Phase 2).
 *
 * NEVER returns process.env.GROQ_API_KEY or any other secret — only the
 * configuration facts Phase 4 explicitly asks for (enabled/provider/
 * model), which are safe by construction because none of them are
 * secrets in the first place.
 */
const prisma = require('../../config/prisma');
const { isConfigured, SUPPORT_MODEL, SUPPORT_MODEL_CHAIN } = require('../../utils/supportAiAssistant');

function getAiConfig() {
  return {
    enabled: isConfigured(),
    provider: 'groq',
    model: SUPPORT_MODEL,
    fallbackModels: SUPPORT_MODEL_CHAIN.slice(1),
  };
}

/**
 * Real request/failure/latency metrics from SupportAiRequestLog — see
 * that model's schema comment: history only exists from when logging was
 * added (Phase 4), which `metricsAvailableSince` surfaces explicitly
 * rather than letting a caller assume this covers all-time usage.
 */
async function getAiMetrics({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const where = { createdAt: { gte: since } };

  const [total, failures, latencyAgg, earliestLog, recentErrors] = await Promise.all([
    prisma.supportAiRequestLog.count({ where }),
    prisma.supportAiRequestLog.count({ where: { ...where, success: false } }),
    prisma.supportAiRequestLog.aggregate({ where: { ...where, success: true }, _avg: { latencyMs: true } }),
    prisma.supportAiRequestLog.aggregate({ _min: { createdAt: true } }),
    prisma.supportAiRequestLog.findMany({
      where: { ...where, success: false },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, model: true, errorMessage: true, createdAt: true, sessionId: true },
    }),
  ]);

  return {
    windowDays: days,
    requestCount: total,
    failureCount: failures,
    successRate: total > 0 ? Number((((total - failures) / total) * 100).toFixed(1)) : null,
    averageLatencyMs: latencyAgg._avg.latencyMs ? Math.round(latencyAgg._avg.latencyMs) : null,
    recentErrors,
    metricsAvailableSince: earliestLog._min.createdAt,
  };
}

async function listAiConversations({ page = 1, pageSize, communityId } = {}) {
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const where = communityId ? { communityId } : {};
  const [total, sessions] = await Promise.all([
    prisma.supportChatSession.count({ where }),
    prisma.supportChatSession.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (pageNum - 1) * size,
      take: size,
      select: {
        id: true,
        title: true,
        communityId: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, fullName: true, email: true } },
        _count: { select: { messages: true } },
      },
    }),
  ]);

  // SupportChatSession.communityId is a plain denormalized field with no
  // Prisma relation (see schema.prisma) — batch-resolve the community
  // names for just this page's ids rather than a per-row query.
  const communityIds = [...new Set(sessions.map((s) => s.communityId).filter(Boolean))];
  const communities = communityIds.length
    ? await prisma.community.findMany({ where: { id: { in: communityIds } }, select: { id: true, name: true, slug: true } })
    : [];
  const communityMap = Object.fromEntries(communities.map((c) => [c.id, c]));

  return {
    data: sessions.map((s) => ({ ...s, community: s.communityId ? communityMap[s.communityId] || null : null })),
    pagination: { page: pageNum, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) },
  };
}

async function getHumanEscalationCount({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return prisma.supportTicket.count({
    where: { originConversationId: { not: null }, createdAt: { gte: since } },
  });
}

module.exports = { getAiConfig, getAiMetrics, listAiConversations, getHumanEscalationCount };
