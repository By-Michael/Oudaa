'use strict';

/**
 * Process-local, in-memory metrics store for Phase 5.
 *
 * Design constraints:
 *  - No external cache (Redis/Memcached) dependency.
 *  - Must not grow without bound — every collection is capped.
 *  - Reads must be O(n) worst-case where n is tiny (< 10 000 samples).
 *  - Must never store request/response bodies, auth tokens, or PII that
 *    would turn this in-memory object into a data leak if a heap dump
 *    were obtained.
 *
 * Time windows the API exposes: 15m, 1h, 6h, 24h, 7d, 30d.
 * We keep two tiers:
 *  - A rolling ring buffer of the last MAX_RAW_SAMPLES individual
 *    request records (timestamp, latency, status, route). Used for
 *    percentile computation and per-window breakdowns inside a ~24h
 *    horizon. Oldest entries are evicted when the cap is reached.
 *  - An array of 5-minute bucket aggregates going back MAX_BUCKETS
 *    periods. Used for the 7d/30d historical charts where per-request
 *    granularity is neither useful nor storable.
 *
 * All times are Unix-epoch milliseconds (Date.now()) for cheap arithmetic.
 */

// --- tuning constants ----------------------------------------------------

/** Maximum individual request records kept in the ring buffer. */
const MAX_RAW_SAMPLES = 5_000;

/** Maximum 5-minute aggregated buckets (30 days × 288 buckets/day). */
const MAX_BUCKETS = 8_640;

/** Bucket duration in ms (5 minutes). */
const BUCKET_MS = 5 * 60 * 1_000;

/** Maximum unique routes tracked in the per-route index. */
const MAX_ROUTE_KEYS = 200;

// --- internal state -------------------------------------------------------

/**
 * Ring buffer of individual request records.
 * Each entry: { ts, latencyMs, status, route, communityId? }
 * `head` always points to the NEXT write position (wraps at MAX_RAW_SAMPLES).
 */
const _raw = {
  buf: new Array(MAX_RAW_SAMPLES).fill(null),
  head: 0,
  size: 0, // logical fill count (never exceeds MAX_RAW_SAMPLES)
};

/**
 * Completed 5-minute aggregate buckets.
 * Each entry: { ts (bucket start), count, errors, sumLatency, p95Latency }
 * Appended by flushBucket(); older ones are evicted when MAX_BUCKETS is hit.
 */
const _buckets = [];

/**
 * Current (open) bucket being accumulated until it's time to flush.
 */
let _currentBucket = null;

/**
 * Per-route counters. Key: normalised route string (e.g. GET /api/v1/payments).
 * Value: { count, errors, sumLatency, minLatency, maxLatency, samples: [] }
 * `samples` is the last 200 latency values for that route (for per-route p95).
 */
const _routes = new Map();

// --- helpers --------------------------------------------------------------

function _now() {
  return Date.now();
}

function _bucketStart(ts) {
  return Math.floor(ts / BUCKET_MS) * BUCKET_MS;
}

/** Compute approximate percentile from a sorted or unsorted array. */
function _percentile(values, p) {
  if (!values || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** Return entries from the ring buffer that fall within [fromTs, toTs]. */
function _rawInWindow(fromTs, toTs) {
  const out = [];
  const len = Math.min(_raw.size, MAX_RAW_SAMPLES);
  for (let i = 0; i < len; i++) {
    const entry = _raw.buf[i];
    if (entry && entry.ts >= fromTs && entry.ts <= toTs) {
      out.push(entry);
    }
  }
  return out;
}

/** Flush the current open bucket into _buckets and start a fresh one. */
function _flushBucket() {
  if (!_currentBucket || _currentBucket.count === 0) {
    _currentBucket = null;
    return;
  }
  const b = _currentBucket;
  const avg = b.count > 0 ? b.sumLatency / b.count : 0;
  _buckets.push({
    ts: b.ts,
    count: b.count,
    errors: b.errors,
    avgLatency: Math.round(avg),
    p95Latency: _percentile(b.samples, 95),
  });
  // Trim oldest to cap
  if (_buckets.length > MAX_BUCKETS) {
    _buckets.splice(0, _buckets.length - MAX_BUCKETS);
  }
  _currentBucket = null;
}

// --- public API -----------------------------------------------------------

/**
 * Record a completed HTTP request.
 * Called by middleware/metricsCollector.js on response finish.
 *
 * @param {object} opts
 * @param {number} opts.ts          Unix-epoch ms when the request arrived.
 * @param {number} opts.latencyMs   Time to first byte (response end) in ms.
 * @param {number} opts.status      HTTP status code.
 * @param {string} opts.route       Normalised route, e.g. "GET /api/v1/payments".
 * @param {string} [opts.communityId]
 */
function record({ ts, latencyMs, status, route, communityId }) {
  // --- ring buffer ---
  _raw.buf[_raw.head] = { ts, latencyMs, status, route, communityId };
  _raw.head = (_raw.head + 1) % MAX_RAW_SAMPLES;
  if (_raw.size < MAX_RAW_SAMPLES) _raw.size++;

  // --- 5-minute bucket ---
  const bStart = _bucketStart(ts);
  if (!_currentBucket || _currentBucket.ts !== bStart) {
    _flushBucket();
    _currentBucket = { ts: bStart, count: 0, errors: 0, sumLatency: 0, samples: [] };
  }
  _currentBucket.count++;
  if (status >= 400) _currentBucket.errors++;
  _currentBucket.sumLatency += latencyMs;
  if (_currentBucket.samples.length < 500) _currentBucket.samples.push(latencyMs);

  // --- per-route index ---
  if (_routes.size >= MAX_ROUTE_KEYS && !_routes.has(route)) {
    // Drop oldest route to stay bounded (routes rarely exceed a few dozen)
    const firstKey = _routes.keys().next().value;
    _routes.delete(firstKey);
  }
  if (!_routes.has(route)) {
    _routes.set(route, { count: 0, errors: 0, sumLatency: 0, minLatency: Infinity, maxLatency: 0, samples: [] });
  }
  const r = _routes.get(route);
  r.count++;
  if (status >= 400) r.errors++;
  r.sumLatency += latencyMs;
  if (latencyMs < r.minLatency) r.minLatency = latencyMs;
  if (latencyMs > r.maxLatency) r.maxLatency = latencyMs;
  if (r.samples.length < 200) r.samples.push(latencyMs);
}

/**
 * Aggregate stats for a given time window.
 *
 * @param {number} windowMs  Duration in ms (e.g. 15*60*1000 for 15 minutes).
 * @returns {{ requestCount, errorCount, successCount, rate4xx, rate5xx,
 *             avgLatency, p50, p95, p99, errorRate,
 *             requestsPerMinute, hasData }}
 */
function getWindowStats(windowMs) {
  const now = _now();
  const from = now - windowMs;
  const entries = _rawInWindow(from, now);

  if (entries.length === 0) {
    return { hasData: false, requestCount: 0, errorCount: 0, successCount: 0,
             rate4xx: 0, rate5xx: 0, avgLatency: 0, p50: 0, p95: 0, p99: 0,
             errorRate: 0, requestsPerMinute: 0 };
  }

  const latencies = entries.map((e) => e.latencyMs);
  const errorCount = entries.filter((e) => e.status >= 400).length;
  const count4xx = entries.filter((e) => e.status >= 400 && e.status < 500).length;
  const count5xx = entries.filter((e) => e.status >= 500).length;
  const sumLat = latencies.reduce((a, b) => a + b, 0);

  return {
    hasData: true,
    requestCount: entries.length,
    errorCount,
    successCount: entries.length - errorCount,
    rate4xx: count4xx,
    rate5xx: count5xx,
    avgLatency: Math.round(sumLat / latencies.length),
    p50: _percentile(latencies, 50),
    p95: _percentile(latencies, 95),
    p99: _percentile(latencies, 99),
    errorRate: +((errorCount / entries.length) * 100).toFixed(2),
    requestsPerMinute: +((entries.length / (windowMs / 60_000))).toFixed(2),
  };
}

/**
 * Return the top N slowest endpoints (by average latency) from the last
 * `windowMs` milliseconds.
 */
function getSlowEndpoints(windowMs = 60 * 60 * 1_000, limit = 10) {
  const now = _now();
  const from = now - windowMs;
  const entries = _rawInWindow(from, now);

  // Group by route
  const byRoute = {};
  for (const e of entries) {
    if (!byRoute[e.route]) byRoute[e.route] = { count: 0, sumLatency: 0, latencies: [] };
    byRoute[e.route].count++;
    byRoute[e.route].sumLatency += e.latencyMs;
    if (byRoute[e.route].latencies.length < 200) byRoute[e.route].latencies.push(e.latencyMs);
  }

  return Object.entries(byRoute)
    .map(([route, d]) => ({
      route,
      count: d.count,
      avgLatency: Math.round(d.sumLatency / d.count),
      p95: _percentile(d.latencies, 95),
    }))
    .sort((a, b) => b.avgLatency - a.avgLatency)
    .slice(0, limit);
}

/**
 * Return the top N highest-traffic endpoints from the last `windowMs` ms.
 */
function getHighTrafficEndpoints(windowMs = 60 * 60 * 1_000, limit = 10) {
  const now = _now();
  const from = now - windowMs;
  const entries = _rawInWindow(from, now);

  const byRoute = {};
  for (const e of entries) {
    if (!byRoute[e.route]) byRoute[e.route] = { count: 0, errors: 0 };
    byRoute[e.route].count++;
    if (e.status >= 400) byRoute[e.route].errors++;
  }

  return Object.entries(byRoute)
    .map(([route, d]) => ({ route, count: d.count, errors: d.errors }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Return bucketed time-series suitable for charts.
 * For short windows we use the raw ring buffer re-bucketed at 1-min intervals;
 * for longer windows we use the 5-min pre-aggregated buckets.
 *
 * @param {number} windowMs
 * @returns {{ points: Array<{ts, count, errors, avgLatency}>, bucketMs }}
 */
function getTimeSeries(windowMs) {
  const now = _now();
  const from = now - windowMs;

  // Choose bucket granularity
  let granularity;
  if (windowMs <= 60 * 60 * 1_000) {
    granularity = 60 * 1_000; // 1-minute buckets for ≤ 1h
  } else if (windowMs <= 6 * 60 * 60 * 1_000) {
    granularity = 5 * 60 * 1_000; // 5-minute buckets for ≤ 6h
  } else {
    granularity = 30 * 60 * 1_000; // 30-minute buckets for longer windows
  }

  const bucketsMap = {};

  if (windowMs <= 24 * 60 * 60 * 1_000) {
    // Use raw ring buffer
    const entries = _rawInWindow(from, now);
    for (const e of entries) {
      const key = Math.floor(e.ts / granularity) * granularity;
      if (!bucketsMap[key]) bucketsMap[key] = { count: 0, errors: 0, sumLat: 0 };
      bucketsMap[key].count++;
      if (e.status >= 400) bucketsMap[key].errors++;
      bucketsMap[key].sumLat += e.latencyMs;
    }
  } else {
    // Use pre-aggregated 5-min buckets
    for (const b of _buckets) {
      if (b.ts < from) continue;
      const key = Math.floor(b.ts / granularity) * granularity;
      if (!bucketsMap[key]) bucketsMap[key] = { count: 0, errors: 0, sumLat: 0 };
      bucketsMap[key].count += b.count;
      bucketsMap[key].errors += b.errors;
      bucketsMap[key].sumLat += b.avgLatency * b.count;
    }
  }

  const points = Object.entries(bucketsMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([ts, d]) => ({
      ts: Number(ts),
      count: d.count,
      errors: d.errors,
      avgLatency: d.count > 0 ? Math.round(d.sumLat / d.count) : 0,
    }));

  return { points, bucketMs: granularity };
}

/**
 * Which time windows actually have data?
 * Returns an array of windowMs values from the requested list that have
 * at least one request in the ring buffer (or the bucket archive).
 */
function availableWindows(candidates) {
  const now = _now();
  return candidates.filter((w) => {
    const from = now - w;
    // Quick check: oldest raw entry
    for (let i = 0; i < Math.min(_raw.size, MAX_RAW_SAMPLES); i++) {
      const e = _raw.buf[i];
      if (e && e.ts >= from) return true;
    }
    // Also check pre-aggregated buckets for longer windows
    return _buckets.some((b) => b.ts >= from && b.count > 0);
  });
}

/** Total lifetime request counter (since last process restart). */
function totalRequests() {
  // Sum raw ring buffer size plus everything flushed to buckets
  const bucketTotal = _buckets.reduce((a, b) => a + b.count, 0);
  return _raw.size + bucketTotal;
}

module.exports = { record, getWindowStats, getSlowEndpoints, getHighTrafficEndpoints,
                   getTimeSeries, availableWindows, totalRequests };
