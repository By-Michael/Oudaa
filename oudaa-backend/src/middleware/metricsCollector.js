'use strict';

/**
 * HTTP metrics collection middleware (Phase 5).
 *
 * Attaches a high-resolution timer to every inbound request and records
 * the result to the in-memory MetricsStore once the response has finished
 * sending. This is the only place where per-request data enters the store —
 * everything else in the metrics system reads from it.
 *
 * Safe-by-design:
 *  - Catches exceptions from the store so a metrics bug can never break
 *    an unrelated API request.
 *  - Never reads or records request/response bodies, cookies, or auth headers.
 *  - Route normalisation strips numeric path segments so
 *    /api/v1/residents/123 → /api/v1/residents/:id (prevents cardinality explosion).
 */

const store = require('../services/platformAdmin/platformMetricsStore');

/**
 * Replace numeric-looking path segments with `:id` to normalise routes.
 * Also replaces UUIDs (xxxxxxxx-xxxx-…) with :id.
 *
 * Examples:
 *   /api/v1/residents/42        → /api/v1/residents/:id
 *   /api/v1/payments/uuid-here  → /api/v1/payments/:id
 */
function normaliseRoute(method, url) {
  // Strip query string
  const path = url.split('?')[0];

  const normalised = path
    // UUID segments
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    // Pure numeric segments
    .replace(/\/\d+/g, '/:id');

  return `${method} ${normalised}`;
}

module.exports = function metricsCollector(req, res, next) {
  const startTs = Date.now();
  const arrivalTs = startTs;

  res.on('finish', () => {
    try {
      const latencyMs = Date.now() - startTs;
      const route = normaliseRoute(req.method, req.originalUrl || req.url);

      store.record({
        ts: arrivalTs,
        latencyMs,
        status: res.statusCode,
        route,
        // communityId is set by tenantScope middleware on community-side
        // routes; undefined for platform-admin and health routes.
        communityId: req.communityId || undefined,
      });
    } catch (_err) {
      // Metrics must never crash the request handler.
    }
  });

  next();
};
