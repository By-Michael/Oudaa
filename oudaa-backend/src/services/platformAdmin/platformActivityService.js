/**
 * Recent-activity feed for the dashboard. Each category is independently
 * gated by the SAME permission that already guards that category's own
 * view route (see src/config/platformPermissions.js) — a caller without
 * platform.audit.view simply gets that section omitted, not empty data
 * that implies "nothing happened".
 */
const prisma = require('../../config/prisma');
const { roleHasPermission, PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');

async function getRecentActivity(role, { limit = 10 } = {}) {
  const result = {};

  if (roleHasPermission(role, PLATFORM_PERMISSIONS.AUDIT_VIEW)) {
    const [recentAudit, recentSecurity] = await Promise.all([
      prisma.platformAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, action: true, entityType: true, entityId: true, actorEmail: true, description: true, success: true, createdAt: true },
      }),
      prisma.platformAuditLog.findMany({
        where: { action: { in: ['LOGIN_FAILED', 'MFA_DISABLED', 'SESSION_REVOKED', 'PERMISSION_CHANGED', 'ROLE_CHANGED'] } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, action: true, actorEmail: true, description: true, createdAt: true },
      }),
    ]);
    result.auditEvents = recentAudit.map((e) => ({ ...e, link: `/platform-admin/audit?entryId=${e.id}` }));
    result.securityEvents = recentSecurity.map((e) => ({ ...e, link: `/platform-admin/security?entryId=${e.id}` }));
  }

  if (roleHasPermission(role, PLATFORM_PERMISSIONS.SUPPORT_VIEW)) {
    const recentSupport = await prisma.supportChatSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, title: true, communityId: true, createdAt: true },
    });
    result.supportActivity = recentSupport.map((s) => ({ ...s, link: `/platform-admin/support?sessionId=${s.id}` }));
  }

  // No request/error-logging table exists yet (see platformAlertsService
  // comment) — "recent errors" has no honest data source, so it's
  // reported as an explicit gap rather than an empty/fabricated list.
  result.recentErrorsAvailable = false;

  return result;
}

module.exports = { getRecentActivity };
