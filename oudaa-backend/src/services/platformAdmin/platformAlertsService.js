/**
 * Derives dashboard alerts from real signals only — never synthetic
 * "sample" alerts. Two sources currently exist in this codebase:
 *   1. System health degradation (see platformHealthService).
 *   2. A burst of failed platform-admin logins in a short window, read
 *      from PlatformAuditLog — a real security signal already being
 *      recorded (see Phase 1).
 *
 * Explicitly NOT included (no honest data source exists yet — see
 * limitations rather than fabricating): elevated API error rates (no
 * request/error logging table), failed integrations (no integrations
 * exist yet), support escalations (no ticket/escalation concept yet).
 * Each of those is a real gap this function documents rather than papers
 * over with invented numbers.
 */
const prisma = require('../../config/prisma');
const { getSystemStatus } = require('./platformHealthService');

const FAILED_LOGIN_WINDOW_MINUTES = 15;
const FAILED_LOGIN_ALERT_THRESHOLD = 5;

async function getAlerts() {
  const alerts = [];

  const health = await getSystemStatus();
  for (const [key, check] of Object.entries(health)) {
    if (key === 'checkedAt') continue;
    if (check.status === 'DEGRADED' || check.status === 'UNAVAILABLE') {
      alerts.push({
        id: `health:${key}`,
        severity: check.status === 'UNAVAILABLE' ? 'critical' : 'warning',
        category: 'service_health',
        title: `${key} is ${check.status.toLowerCase()}`,
        detail: check.error || (check.latencyMs ? `Responded in ${check.latencyMs}ms` : undefined),
        occurredAt: health.checkedAt,
      });
    }
  }

  const since = new Date(Date.now() - FAILED_LOGIN_WINDOW_MINUTES * 60 * 1000);
  const failedLoginsByEmail = await prisma.platformAuditLog.groupBy({
    by: ['actorEmail'],
    where: { action: 'LOGIN_FAILED', createdAt: { gte: since }, actorEmail: { not: null } },
    _count: { _all: true },
  });
  for (const row of failedLoginsByEmail) {
    if (row._count._all >= FAILED_LOGIN_ALERT_THRESHOLD) {
      alerts.push({
        id: `failed-logins:${row.actorEmail}`,
        severity: 'warning',
        category: 'security',
        title: `Repeated failed platform login attempts for ${row.actorEmail}`,
        detail: `${row._count._all} failed attempts in the last ${FAILED_LOGIN_WINDOW_MINUTES} minutes`,
        occurredAt: new Date().toISOString(),
        linkHint: { type: 'audit', filter: { action: 'LOGIN_FAILED', actorEmail: row.actorEmail } },
      });
    }
  }

  return {
    alerts,
    unavailableCategories: [
      { category: 'api_errors', reason: 'No request/error logging table exists yet' },
      { category: 'failed_integrations', reason: 'No integrations exist yet' },
      { category: 'support_escalations', reason: 'No support ticket/escalation model exists yet' },
    ],
  };
}

module.exports = { getAlerts };
