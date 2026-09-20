'use strict';

/**
 * Platform performance & monitoring controller (Phase 5).
 *
 * All handlers are thin — they validate inputs, call the appropriate service,
 * and return a standardised JSON envelope. No business logic lives here.
 *
 * Route map (see platformPerformanceRoutes.js):
 *
 *   GET /performance/overview         System status + process headline
 *   GET /performance/process          Full process metrics
 *   GET /performance/api              API stats for a time window
 *   GET /performance/api/series       Time-series data for charts
 *   GET /performance/api/endpoints    Slow + high-traffic endpoints
 *   GET /performance/api/windows      Available time windows
 *   GET /performance/database         DB connectivity, size, migrations
 *   GET /performance/storage          Storage configuration
 *   GET /performance/integrations     All integration statuses
 *   GET /performance/errors           Error log (filterable)
 *   GET /performance/errors/groups    Grouped error summary
 *   GET /performance/errors/summary   Error count summary
 *   GET /performance/snapshots        Historical metric snapshots
 */

const catchAsync = require('../../utils/catchAsync');
const metricsService = require('../../services/platformAdmin/platformMetricsService');
const perfService = require('../../services/platformAdmin/platformPerformanceService');
const errorLogService = require('../../services/platformAdmin/platformErrorLogService');
const store = require('../../services/platformAdmin/platformMetricsStore');

// ---- Window parsing -------------------------------------------------------

const WINDOW_MAP = {
  '15m':  15 * 60 * 1_000,
  '1h':    1 * 60 * 60 * 1_000,
  '6h':    6 * 60 * 60 * 1_000,
  '24h':  24 * 60 * 60 * 1_000,
  '7d':    7 * 24 * 60 * 60 * 1_000,
  '30d':  30 * 24 * 60 * 60 * 1_000,
};

function resolveWindow(query, defaultWindow = '1h') {
  const key = query.window || defaultWindow;
  return WINDOW_MAP[key] || WINDOW_MAP[defaultWindow];
}

// ---- Overview --------------------------------------------------------------

/**
 * High-level status page: system status + process headline.
 * Designed to answer "is everything healthy?" without requiring multiple
 * sub-section loads.
 */
const overview = catchAsync(async (req, res) => {
  const [systemStatus, processMetrics] = await Promise.all([
    perfService.getSystemStatus(),
    metricsService.getProcessMetrics(),
  ]);

  const apiStats = metricsService.getApiStats(WINDOW_MAP['1h']);

  res.json({
    success: true,
    data: {
      systemStatus,
      process: {
        nodeVersion: processMetrics.nodeVersion,
        uptimeSec: processMetrics.uptimeSec,
        startedAt: processMetrics.startedAt,
        memory: processMetrics.memory,
        cpu: processMetrics.cpu,
        eventLoopLagMs: processMetrics.eventLoopLagMs,
      },
      apiSummary: {
        window: '1h',
        requestCount: apiStats.requestCount,
        errorRate: apiStats.errorRate,
        avgLatency: apiStats.avgLatency,
        p95: apiStats.p95,
        hasData: apiStats.hasData,
      },
    },
  });
});

// ---- Process ---------------------------------------------------------------

const process_ = catchAsync(async (req, res) => {
  const data = await metricsService.getProcessMetrics();
  res.json({ success: true, data });
});

// ---- API stats -------------------------------------------------------------

const apiStats = catchAsync(async (req, res) => {
  const windowMs = resolveWindow(req.query);
  const data = metricsService.getApiStats(windowMs);
  res.json({ success: true, data: { ...data, window: req.query.window || '1h', windowMs } });
});

const apiSeries = catchAsync(async (req, res) => {
  const windowMs = resolveWindow(req.query, '1h');
  const data = store.getTimeSeries(windowMs);
  res.json({ success: true, data: { ...data, window: req.query.window || '1h', windowMs } });
});

const apiEndpoints = catchAsync(async (req, res) => {
  const windowMs = resolveWindow(req.query, '1h');
  const [slow, highTraffic] = await Promise.all([
    store.getSlowEndpoints(windowMs, 10),
    store.getHighTrafficEndpoints(windowMs, 10),
  ]);
  res.json({
    success: true,
    data: { slow, highTraffic, window: req.query.window || '1h', windowMs },
  });
});

const apiWindows = catchAsync(async (req, res) => {
  const available = metricsService.getAvailableWindows();
  res.json({ success: true, data: { available, all: Object.keys(WINDOW_MAP) } });
});

// ---- Database --------------------------------------------------------------

const database = catchAsync(async (req, res) => {
  const data = await perfService.getDatabaseSection();
  // Explicitly strip connection string / credentials from any result that
  // might accidentally surface them (defensive — the service should already
  // not include them, but belt-and-suspenders for a security-sensitive route).
  if (data.connectionInfo) {
    delete data.connectionInfo.connectionString;
    delete data.connectionInfo.password;
  }
  res.json({ success: true, data });
});

// ---- Storage ---------------------------------------------------------------

const storage = catchAsync(async (req, res) => {
  const data = perfService.getStorageSection();
  res.json({ success: true, data });
});

// ---- Integrations ----------------------------------------------------------

const integrations = catchAsync(async (req, res) => {
  const data = await perfService.getIntegrationsSection();
  res.json({ success: true, data });
});

// ---- Errors ----------------------------------------------------------------

const errors = catchAsync(async (req, res) => {
  const { window = '24h', limit, statusCode, endpoint } = req.query;
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const parsedStatus = statusCode ? parseInt(statusCode, 10) : undefined;

  const rows = await errorLogService.getErrors({
    window,
    limit: parsedLimit,
    statusCode: parsedStatus,
    endpoint,
  });

  res.json({ success: true, data: rows });
});

const errorGroups = catchAsync(async (req, res) => {
  const { window = '24h' } = req.query;
  const data = await errorLogService.getErrorGroups({ window });
  res.json({ success: true, data });
});

const errorSummary = catchAsync(async (req, res) => {
  const windowMs = resolveWindow(req.query, '24h');
  const data = await errorLogService.getErrorSummary(windowMs);
  res.json({ success: true, data });
});

// ---- Historical snapshots --------------------------------------------------

const snapshots = catchAsync(async (req, res) => {
  const windowMs = resolveWindow(req.query, '24h');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 288, 1), 2_000);
  const data = await metricsService.getHistoricalSnapshots(windowMs, limit);
  res.json({
    success: true,
    data: { snapshots: data, window: req.query.window || '24h', windowMs, count: data.length },
  });
});

module.exports = {
  overview,
  process: process_,
  apiStats,
  apiSeries,
  apiEndpoints,
  apiWindows,
  database,
  storage,
  integrations,
  errors,
  errorGroups,
  errorSummary,
  snapshots,
};
