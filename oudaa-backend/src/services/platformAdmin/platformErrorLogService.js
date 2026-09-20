'use strict';

/**
 * Platform error log service (Phase 5).
 *
 * Stores structured, safe error records in PlatformErrorLog.
 * Called by the global error handler middleware for any 4xx/5xx response.
 *
 * Safety rules:
 *  - Never stores request body, auth tokens, passwords, or session cookies.
 *  - Never stores stack traces that might contain file paths or internal
 *    module names (those remain server-console only).
 *  - Error messages are truncated to 500 chars to prevent unbounded rows.
 *  - communityId / userId / platformAdminId are stored only when already
 *    present on req (set by earlier auth middleware) — we never derive them.
 */

const prisma = require('../../config/prisma');

function sanitizeOperationalMessage(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|access_token|refresh_token|api[_-]?key|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|secret|password|token)\s*[:=]\s*)[^,;\s]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s?]+\?[^\s]+/gi, (url) => url.split('?')[0])
    .slice(0, 500)
}


/** Categorise an HTTP status code into a human-readable error category. */
function categorise(status) {
  if (status === 400) return 'Bad Request';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not Found';
  if (status === 409) return 'Conflict';
  if (status === 422) return 'Validation Error';
  if (status === 429) return 'Rate Limited';
  if (status >= 400 && status < 500) return 'Client Error';
  if (status === 500) return 'Internal Server Error';
  if (status === 502) return 'Bad Gateway';
  if (status === 503) return 'Service Unavailable';
  if (status >= 500) return 'Server Error';
  return 'Unknown';
}

/**
 * Capture an error event from the global error handler.
 *
 * @param {object} opts
 * @param {import('express').Request}  opts.req
 * @param {number}                     opts.statusCode
 * @param {string}                     opts.message     Safe, operational message
 * @param {number}                     [opts.latencyMs]
 */
async function captureError({ req, statusCode, message, latencyMs }) {
  try {
    // Normalise the endpoint — strip numeric/UUID path segments, drop query string.
    const rawPath = (req.originalUrl || req.url || '').split('?')[0];
    const endpoint = rawPath
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
      .replace(/\/\d+/g, '/:id')
      .substring(0, 200);

    await prisma.platformErrorLog.create({
      data: {
        requestId:       req.requestId   || null,
        method:          (req.method     || 'UNKNOWN').substring(0, 10),
        endpoint,
        statusCode,
        errorCategory:   categorise(statusCode),
        errorMessage:    sanitizeOperationalMessage(message),
        communityId:     req.communityId || null,
        userId:          req.user?.id    || null,
        platformAdminId: req.platformAdmin?.id || null,
        latencyMs:       latencyMs != null ? Math.round(latencyMs) : null,
      },
    });
  } catch (_err) {
    // Error logging must never crash the error handler.
  }
}

/** VALID_WINDOWS for query filter. */
const VALID_WINDOWS = {
  '15m':  15 * 60 * 1_000,
  '1h':    1 * 60 * 60 * 1_000,
  '6h':    6 * 60 * 60 * 1_000,
  '24h':  24 * 60 * 60 * 1_000,
  '7d':    7 * 24 * 60 * 60 * 1_000,
  '30d':  30 * 24 * 60 * 60 * 1_000,
};

/**
 * Retrieve recent error log entries.
 *
 * @param {object} opts
 * @param {string} [opts.window='24h']    One of the keys in VALID_WINDOWS.
 * @param {number} [opts.limit=100]       Max rows to return.
 * @param {number} [opts.statusCode]      Filter by exact HTTP status.
 * @param {string} [opts.endpoint]        Filter by endpoint prefix.
 */
async function getErrors({ window = '24h', limit = 100, statusCode, endpoint } = {}) {
  const windowMs = VALID_WINDOWS[window] || VALID_WINDOWS['24h'];
  const from = new Date(Date.now() - windowMs);

  const where = { timestamp: { gte: from } };
  if (statusCode) where.statusCode = statusCode;
  if (endpoint) where.endpoint = { startsWith: endpoint };

  const rows = await prisma.platformErrorLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(Math.max(limit, 1), 500),
    select: {
      id: true,
      timestamp: true,
      requestId: true,
      method: true,
      endpoint: true,
      statusCode: true,
      errorCategory: true,
      errorMessage: true,
      communityId: true,
      userId: true,
      platformAdminId: true,
      latencyMs: true,
    },
  });

  return rows;
}

/**
 * Return grouped error counts by endpoint + statusCode for the given window.
 * Useful for the "similar errors" / grouping view.
 */
async function getErrorGroups({ window = '24h' } = {}) {
  const windowMs = VALID_WINDOWS[window] || VALID_WINDOWS['24h'];
  const from = new Date(Date.now() - windowMs);

  // Prisma groupBy
  const groups = await prisma.platformErrorLog.groupBy({
    by: ['endpoint', 'statusCode', 'errorCategory'],
    where: { timestamp: { gte: from } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 50,
  });

  return groups.map((g) => ({
    endpoint: g.endpoint,
    statusCode: g.statusCode,
    errorCategory: g.errorCategory,
    count: g._count.id,
  }));
}

/**
 * Quick summary counts for the error center header.
 */
async function getErrorSummary(windowMs = 24 * 60 * 60 * 1_000) {
  const from = new Date(Date.now() - windowMs);

  const [total, by5xx, by4xx] = await Promise.all([
    prisma.platformErrorLog.count({ where: { timestamp: { gte: from } } }),
    prisma.platformErrorLog.count({ where: { timestamp: { gte: from }, statusCode: { gte: 500 } } }),
    prisma.platformErrorLog.count({ where: { timestamp: { gte: from }, statusCode: { gte: 400, lt: 500 } } }),
  ]);

  return { total, serverErrors: by5xx, clientErrors: by4xx };
}

module.exports = { captureError, getErrors, getErrorGroups, getErrorSummary };
