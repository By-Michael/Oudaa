/**
 * Support analytics (Phase 4). Every number is a real DB aggregate over
 * SupportTicket/SupportTicketMessage/SupportChatSession — no synthetic
 * "sample" data, and a metric with no data yet reads as 0/null rather
 * than being omitted or guessed.
 */
const prisma = require('../../config/prisma');

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function getOverview({ days = 30 } = {}) {
  const since = daysAgo(days);

  const [
    openCount,
    byPriority,
    byCategory,
    escalatedCount,
    resolvedInWindow,
    aiConversationsInWindow,
    ticketsInWindow,
  ] = await Promise.all([
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER'] } } }),
    prisma.supportTicket.groupBy({ by: ['priority'], _count: { _all: true } }),
    prisma.supportTicket.groupBy({ by: ['category'], _count: { _all: true } }),
    prisma.supportTicket.count({ where: { status: 'ESCALATED' } }),
    prisma.supportTicket.findMany({
      where: { resolvedAt: { not: null, gte: since } },
      select: { createdAt: true, resolvedAt: true },
    }),
    prisma.supportChatSession.count({ where: { createdAt: { gte: since } } }),
    prisma.supportTicket.count({ where: { createdAt: { gte: since } } }),
  ]);

  // Average time-to-first-agent-response per ticket, computed from the
  // real message timestamps (first non-internal-note agent message minus
  // ticket.createdAt) rather than a stored "responseTime" field that
  // could drift from what actually happened.
  const ticketsWithFirstResponse = await prisma.$queryRaw`
    SELECT t.id, t."createdAt" AS ticket_created, MIN(m."createdAt") AS first_agent_response
    FROM "support_tickets" t
    JOIN "support_ticket_messages" m ON m."ticketId" = t.id AND m."authorPlatformAdminId" IS NOT NULL AND m."isInternalNote" = false
    WHERE t."createdAt" >= ${since}
    GROUP BY t.id, t."createdAt"
  `;

  const responseTimesMs = ticketsWithFirstResponse
    .map((r) => new Date(r.first_agent_response).getTime() - new Date(r.ticket_created).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const avgResponseTimeMs = responseTimesMs.length
    ? Math.round(responseTimesMs.reduce((a, b) => a + b, 0) / responseTimesMs.length)
    : null;

  const resolutionTimesMs = resolvedInWindow
    .map((t) => new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const avgResolutionTimeMs = resolutionTimesMs.length
    ? Math.round(resolutionTimesMs.reduce((a, b) => a + b, 0) / resolutionTimesMs.length)
    : null;

  return {
    windowDays: days,
    openTickets: openCount,
    byPriority: Object.fromEntries(byPriority.map((r) => [r.priority, r._count._all])),
    byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r._count._all])),
    escalations: escalatedCount,
    averageResponseTimeMs: avgResponseTimeMs,
    averageResolutionTimeMs: avgResolutionTimeMs,
    resolvedCountInWindow: resolvedInWindow.length,
    aiVsHuman: {
      aiConversations: aiConversationsInWindow,
      humanTickets: ticketsInWindow,
    },
  };
}

/**
 * Daily ticket-volume time series — same "single grouped raw query, not
 * one query per day" pattern as the Phase 2 dashboard growth chart.
 */
async function getVolumeChart({ days = 30 } = {}) {
  const since = daysAgo(days - 1);
  const rows = await prisma.$queryRaw`
    SELECT DATE("createdAt") AS day, COUNT(*)::int AS count
    FROM "support_tickets"
    WHERE "createdAt" >= ${since}
    GROUP BY DATE("createdAt")
    ORDER BY day ASC
  `;
  return { since: since.toISOString(), series: rows.map((r) => ({ date: r.day, count: r.count })) };
}

module.exports = { getOverview, getVolumeChart };
