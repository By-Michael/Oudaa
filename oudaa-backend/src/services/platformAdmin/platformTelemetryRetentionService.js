'use strict';

const prisma = require('../../config/prisma');

const DEFAULTS = Object.freeze({
  errorDays: Number(process.env.PLATFORM_ERROR_LOG_RETENTION_DAYS) || 30,
  integrationDays: Number(process.env.PLATFORM_INTEGRATION_EVENT_RETENTION_DAYS) || 90,
  snapshotDays: Number(process.env.PLATFORM_METRIC_SNAPSHOT_RETENTION_DAYS) || 90,
});

async function cleanupTelemetry({ errorDays = DEFAULTS.errorDays, integrationDays = DEFAULTS.integrationDays, snapshotDays = DEFAULTS.snapshotDays } = {}) {
  const now = Date.now();
  const [errors, integrations, snapshots] = await Promise.all([
    prisma.platformErrorLog.deleteMany({
      where: { timestamp: { lt: new Date(now - Number(errorDays) * 24 * 60 * 60 * 1000) } },
    }),
    prisma.platformIntegrationEvent.deleteMany({
      where: { createdAt: { lt: new Date(now - Number(integrationDays) * 24 * 60 * 60 * 1000) } },
    }),
    prisma.platformMetricSnapshot.deleteMany({
      where: { timestamp: { lt: new Date(now - Number(snapshotDays) * 24 * 60 * 60 * 1000) } },
    }),
  ]);

  return {
    errorLogs: errors.count,
    integrationEvents: integrations.count,
    metricSnapshots: snapshots.count,
  };
}

module.exports = { DEFAULTS, cleanupTelemetry };
