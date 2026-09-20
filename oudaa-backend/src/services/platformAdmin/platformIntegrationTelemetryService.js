'use strict';

const prisma = require('../../config/prisma');

function sanitizeOperationalMessage(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|access_token|refresh_token|api[_-]?key|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|secret|password|token)\s*[:=]\s*)[^,;\s]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s?]+\?[^\s]+/gi, (url) => url.split('?')[0])
    .slice(0, 500)
}


async function recordIntegrationEvent({ integration, operation = 'HEALTH_CHECK', success, latencyMs = null, errorMessage = null }) {
  try {
    await prisma.platformIntegrationEvent.create({
      data: {
        integration,
        operation,
        success: !!success,
        latencyMs: latencyMs == null ? null : Math.max(0, Math.round(latencyMs)),
        errorMessage: errorMessage ? sanitizeOperationalMessage(errorMessage) : null,
      },
    });
  } catch (_err) {
    // Telemetry must never affect the health endpoint or the underlying operation.
  }
}

async function getIntegrationTelemetry(integration, windowHours = 24 * 30) {
  try {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const [lastSuccess, lastFailure, errorCount] = await Promise.all([
      prisma.platformIntegrationEvent.findFirst({
        where: { integration, success: true },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, operation: true, latencyMs: true },
      }),
      prisma.platformIntegrationEvent.findFirst({
        where: { integration, success: false },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, operation: true, latencyMs: true, errorMessage: true },
      }),
      prisma.platformIntegrationEvent.count({
        where: { integration, success: false, createdAt: { gte: since } },
      }),
    ]);
    return { lastSuccess, lastFailure, errorCount, errorWindowHours: windowHours, source: 'status telemetry' };
  } catch (_err) {
    return { lastSuccess: null, lastFailure: null, errorCount: null, errorWindowHours: windowHours, source: 'unavailable' };
  }
}

module.exports = { recordIntegrationEvent, getIntegrationTelemetry };
