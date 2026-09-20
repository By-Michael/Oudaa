'use strict';

/**
 * Platform performance metrics service (Phase 5).
 *
 * Collects:
 *  - Node.js process metrics (version, uptime, PID, memory, CPU, handles)
 *  - Event-loop lag (measured, not estimated)
 *  - API request statistics (delegated to platformMetricsStore)
 *  - Historical 5-minute snapshots (written to PlatformMetricSnapshot table)
 *
 * Snapshot deduplication strategy: before writing a new snapshot we check
 * whether any snapshot exists whose timestamp is within the last
 * SNAPSHOT_INTERVAL_MS. This prevents duplicate rows when multiple Node
 * processes happen to run on the same host (e.g. during a rolling deploy)
 * — whichever process writes first wins; the others skip that interval.
 * This is a safe, portable strategy that requires only a standard
 * SELECT + INSERT without needing Postgres advisory locks.
 */

const { performance } = require('perf_hooks');
const os = require('os');
const prisma = require('../../config/prisma');
const store = require('./platformMetricsStore');
const notificationService = require('./platformNotificationService');

/** How often the snapshot collector runs (ms). */
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes

/** Minimum gap between stored snapshots for dedup check (ms). */
const SNAPSHOT_DEDUP_WINDOW_MS = 4 * 60 * 1_000; // 4 minutes

// ---- process metrics -------------------------------------------------------

/**
 * Measure event-loop lag with a setImmediate timer.
 * Schedules a callback at the end of the current event-loop tick; the
 * difference between scheduled time and actual callback time is the lag.
 * Resolves in ≤ one event-loop cycle — for monitoring purposes that's fine.
 *
 * @returns {Promise<number>} lag in milliseconds
 */
function measureEventLoopLag() {
  return new Promise((resolve) => {
    const before = performance.now();
    setImmediate(() => {
      resolve(Math.round((performance.now() - before) * 100) / 100);
    });
  });
}

/**
 * Collect all Node.js process-level metrics.
 * Returns only information that is always available in Node — never exposes
 * hostnames, file paths beyond what Node itself exposes, or env vars.
 *
 * @returns {Promise<object>}
 */
async function getProcessMetrics() {
  const mem = process.memoryUsage();
  const cpuUsage = process.cpuUsage(); // cumulative user+system µs since process start
  const uptimeSec = process.uptime();
  const eventLoopLagMs = await measureEventLoopLag();

  // Active handles — process._getActiveHandles() is an undocumented V8 API
  // that exists in all LTS versions but could theoretically be removed.
  // Guard defensively.
  let activeHandles = null;
  try {
    activeHandles = typeof process._getActiveHandles === 'function'
      ? process._getActiveHandles().length
      : null;
  } catch (_) {}

  // CPU % approximation: user+system µs / (uptime µs). This gives lifetime
  // average utilisation, not an instantaneous reading, but is the best we
  // can do without a 100ms poll loop that would add overhead.
  const totalCpuMicros = cpuUsage.user + cpuUsage.system;
  const cpuPercent = uptimeSec > 0
    ? +((totalCpuMicros / (uptimeSec * 1_000_000)) * 100).toFixed(2)
    : null;

  return {
    nodeVersion: process.version,
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    uptimeSec: Math.floor(uptimeSec),
    startedAt: new Date(Date.now() - uptimeSec * 1_000).toISOString(),
    memory: {
      rssMb: +(mem.rss / 1_048_576).toFixed(2),
      heapUsedMb: +(mem.heapUsed / 1_048_576).toFixed(2),
      heapTotalMb: +(mem.heapTotal / 1_048_576).toFixed(2),
      externalMb: +(mem.external / 1_048_576).toFixed(2),
      arrayBuffersMb: +(((mem.arrayBuffers || 0)) / 1_048_576).toFixed(2),
    },
    cpu: {
      percent: cpuPercent,
      userMicros: cpuUsage.user,
      systemMicros: cpuUsage.system,
      note: 'Lifetime average utilisation since process start',
    },
    eventLoopLagMs,
    activeHandles,
    // System context — non-sensitive: logical CPU count and total RAM.
    // These describe the container/VM, not the host cluster.
    system: {
      cpus: os.cpus().length,
      totalMemoryMb: +(os.totalmem() / 1_048_576).toFixed(0),
      freeMemoryMb: +(os.freemem() / 1_048_576).toFixed(0),
    },
  };
}

// ---- API metrics -----------------------------------------------------------

/**
 * Return API statistics for a given time window (in ms).
 * Re-exports from the in-memory store with supplementary fields.
 */
function getApiStats(windowMs) {
  return {
    ...store.getWindowStats(windowMs),
    totalLifetimeRequests: store.totalRequests(),
  };
}

/**
 * Return the available time-window options (only those with actual data).
 * Candidates: 15m, 1h, 6h, 24h, 7d, 30d.
 */
function getAvailableWindows() {
  const candidates = {
    '15m':  15 * 60 * 1_000,
    '1h':    1 * 60 * 60 * 1_000,
    '6h':    6 * 60 * 60 * 1_000,
    '24h':  24 * 60 * 60 * 1_000,
    '7d':    7 * 24 * 60 * 60 * 1_000,
    '30d':  30 * 24 * 60 * 60 * 1_000,
  };
  const available = store.availableWindows(Object.values(candidates));
  return Object.entries(candidates)
    .filter(([, ms]) => available.includes(ms))
    .map(([label, ms]) => ({ label, ms }));
}

// ---- historical snapshots --------------------------------------------------

/**
 * Collect and persist a PlatformMetricSnapshot row.
 *
 * Deduplication: skip if any snapshot already exists within the last
 * SNAPSHOT_DEDUP_WINDOW_MS. This makes the collector safe to run in
 * multiple Node processes without generating duplicate rows.
 *
 * Called from server.js every SNAPSHOT_INTERVAL_MS milliseconds.
 */
async function collectAndStoreSnapshot() {
  try {
    // Dedup check
    const recent = await prisma.platformMetricSnapshot.findFirst({
      where: { timestamp: { gte: new Date(Date.now() - SNAPSHOT_DEDUP_WINDOW_MS) } },
      select: { id: true },
    });
    if (recent) return; // Another process already stored this interval's snapshot

    const windowMs = SNAPSHOT_INTERVAL_MS;
    const stats = store.getWindowStats(windowMs);

    // DB latency — a real SELECT 1 timing
    let dbLatencyMs = null;
    try {
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - t0;
    } catch (_) {}

    const mem = process.memoryUsage();
    const memUsedMb = +(mem.heapUsed / 1_048_576).toFixed(2);

    const cpuUsage = process.cpuUsage();
    const uptimeSec = process.uptime();
    const cpuPercent = uptimeSec > 0
      ? +((( cpuUsage.user + cpuUsage.system) / (uptimeSec * 1_000_000)) * 100).toFixed(2)
      : null;

    const activeSessions = await prisma.platformAdminSession.count({
      where: { revoked: false, expiresAt: { gt: new Date() } },
    });

    await prisma.platformMetricSnapshot.create({
      data: {
        requestCount: stats.requestCount,
        errorCount: stats.errorCount,
        averageLatency: stats.avgLatency,
        p95Latency: stats.p95,
        cpuPercent,
        memoryUsedMb: memUsedMb,
        dbLatencyMs,
        activeSessions,
        collectedBy: `pid:${process.pid}`,
      },
    });

    // Notify operators when the persisted metrics cross coarse operational
    // thresholds, with a 15-minute DB-backed de-duplication window.
    if (stats.p95 >= 2000 || (stats.requestCount >= 20 && stats.errorRate >= 10)) {
      const recentAlert = await prisma.platformNotification.findFirst({
        where: { type: 'PERFORMANCE_DEGRADATION', createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
        select: { id: true },
      });
      if (!recentAlert) {
        await notificationService.createNotification({
          type: 'PERFORMANCE_DEGRADATION',
          severity: 'WARNING',
          title: 'Performance degradation detected',
          message: `Recent platform metrics crossed an alert threshold (p95 ${stats.p95}ms, error rate ${stats.errorRate}%).`,
          route: '/platform-admin/performance',
          metadata: { p95LatencyMs: stats.p95, errorRate: stats.errorRate, requestCount: stats.requestCount },
        }).catch(() => {});
      }
    }
  } catch (err) {
    // Snapshot failure must never crash the server.
    console.error('[metrics] snapshot collection failed:', err.message);
  }
}

/**
 * Retrieve historical snapshots for charting.
 * Returns at most `limit` rows ordered newest-first, filtered to `windowMs`.
 */
async function getHistoricalSnapshots(windowMs = 24 * 60 * 60 * 1_000, limit = 288) {
  const from = new Date(Date.now() - windowMs);
  const rows = await prisma.platformMetricSnapshot.findMany({
    where: { timestamp: { gte: from } },
    orderBy: { timestamp: 'asc' },
    take: Math.min(limit, 2_000),
    select: {
      timestamp: true,
      requestCount: true,
      errorCount: true,
      averageLatency: true,
      p95Latency: true,
      cpuPercent: true,
      memoryUsedMb: true,
      dbLatencyMs: true,
      activeSessions: true,
    },
  });
  return rows;
}

module.exports = {
  getProcessMetrics,
  getApiStats,
  getAvailableWindows,
  collectAndStoreSnapshot,
  getHistoricalSnapshots,
  SNAPSHOT_INTERVAL_MS,
  // exported for tests
  measureEventLoopLag,
};
