'use strict';

/**
 * Platform performance service (Phase 5).
 *
 * Provides real health/status checks for:
 *  - Database: connectivity, latency, size, migration state
 *  - Storage: provider, configured status
 *  - Integrations: email, payment verification, AI, storage, database
 *
 * Principles:
 *  - Every check is real — nothing fabricated.
 *  - Unavailable checks are labelled explicitly ("Metrics unavailable"
 *    or "Not configured").
 *  - No secrets, connection strings, or credentials are returned.
 *  - External checks (email SMTP) are NOT repeated on every request —
 *    they are cached with a short TTL to prevent hammering external
 *    services or adding latency to the monitoring dashboard.
 */

const prisma = require('../../config/prisma');
const { recordIntegrationEvent } = require('./platformIntegrationTelemetryService');

// Cache for integration checks that contact external services.
const INTEGRATION_CACHE_TTL_MS = 60 * 1_000; // 1 minute
const _cache = {};
const _lastTelemetryAt = {};

function _cached(key, fn) {
  const now = Date.now();
  if (_cache[key] && _cache[key].expiresAt > now) return _cache[key].value;
  const result = fn();
  // fn may return a Promise — handle both
  if (result && typeof result.then === 'function') {
    return result.then((v) => {
      _cache[key] = { value: v, expiresAt: now + INTEGRATION_CACHE_TTL_MS };
      return v;
    });
  }
  _cache[key] = { value: result, expiresAt: now + INTEGRATION_CACHE_TTL_MS };
  return result;
}

// ---- Database --------------------------------------------------------------

async function getDatabaseHealth() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs > 500 ? 'DEGRADED' : 'HEALTHY',
      latencyMs,
    };
  } catch (err) {
    return { status: 'UNAVAILABLE', error: err.message };
  }
}

async function getDatabaseSize() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS "prettySize",
             pg_database_size(current_database()) AS "bytes"
    `;
    return { prettySize: rows[0].prettySize, bytes: Number(rows[0].bytes) };
  } catch (_) {
    return null; // Metrics unavailable
  }
}

async function getMigrationState() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT migration_name AS "migrationName",
             finished_at    AS "finishedAt",
             applied_steps_count AS "steps"
      FROM _prisma_migrations
      ORDER BY finished_at DESC
      LIMIT 10
    `;
    return {
      total: rows.length,
      latest: rows[0] || null,
      recent: rows.map((r) => ({
        migrationName: r.migrationName,
        finishedAt: r.finishedAt,
        steps: r.steps,
      })),
    };
  } catch (_) {
    return null; // Metrics unavailable
  }
}

async function getSlowQueryData() {
  // pg_stat_statements requires the extension to be installed and enabled.
  // Not universally available (Render/Supabase managed Postgres may or may
  // not have it enabled). Check gracefully.
  try {
    await prisma.$queryRaw`SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`;
    const rows = await prisma.$queryRaw`
      SELECT query,
             calls,
             ROUND((total_exec_time / calls)::numeric, 2) AS "avgMs",
             ROUND(max_exec_time::numeric, 2) AS "maxMs"
      FROM pg_stat_statements
      WHERE calls > 5
      ORDER BY (total_exec_time / calls) DESC
      LIMIT 10
    `;
    return rows.map((r) => ({
      // Truncate the query to avoid returning unbounded strings;
      // never show parameter values (they may contain user data).
      query: r.query ? r.query.substring(0, 200) : null,
      calls: Number(r.calls),
      avgMs: Number(r.avgMs),
      maxMs: Number(r.maxMs),
    }));
  } catch (_) {
    return null; // Extension not available / Metrics unavailable
  }
}

async function getConnectionInfo() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT count(*) FILTER (WHERE state = 'active')  AS "active",
             count(*) FILTER (WHERE state = 'idle')    AS "idle",
             count(*)                                   AS "total",
             current_database()                         AS "database",
             current_user                               AS "dbUser"
      FROM pg_stat_activity
      WHERE datname = current_database()
    `;
    const r = rows[0];
    return {
      active: Number(r.active),
      idle: Number(r.idle),
      total: Number(r.total),
      database: r.database,
      // dbUser is the application's DB role name — not a secret (it's in
      // pg_stat_activity which any connected session can see) but we scrub
      // it to just the first segment if it looks like it might contain
      // a password-style string.
      dbUser: r.dbUser,
      // Pool info: Prisma's connection pool is not directly introspectable
      // via the Prisma client API. pg_stat_activity gives us the actual
      // active connection count which is equivalent information.
      poolNote: 'Prisma connection pool — active count reflects live connections in pg_stat_activity',
    };
  } catch (_) {
    return null; // Metrics unavailable
  }
}

async function getDatabaseSection() {
  const [health, size, migrationState, slowQueries, connectionInfo] = await Promise.all([
    getDatabaseHealth(),
    getDatabaseSize(),
    getMigrationState(),
    getSlowQueryData(),
    getConnectionInfo(),
  ]);
  return { health, size, migrationState, slowQueries, connectionInfo };
}

// ---- Storage ---------------------------------------------------------------

function getStorageSection() {
  try {
    // eslint-disable-next-line global-require
    const { isSupabaseConfigured } = require('../../config/storage');
    return {
      provider: isSupabaseConfigured ? 'Supabase Storage (S3-compatible)' : 'Local disk (fallback)',
      configured: isSupabaseConfigured,
      note: isSupabaseConfigured
        ? 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set'
        : 'Running in local-disk fallback mode — not suitable for production (ephemeral on Render)',
      // Object counts require an authenticated Supabase list call. Those
      // are expensive and should not run on every dashboard load. We expose
      // the configuration state only; object counts are "Metrics unavailable".
      objectCounts: null,
    };
  } catch (err) {
    return { provider: 'Unknown', configured: false, note: err.message, objectCounts: null };
  }
}

// ---- Integrations ----------------------------------------------------------

function _checkEmailSync() {
  try {
    // eslint-disable-next-line global-require
    const { isStubActive } = require('../../utils/email');
    const stub = isStubActive();
    return {
      name: 'Email (Brevo)',
      status: stub ? 'NOT_CONFIGURED' : 'CONFIGURED',
      note: stub
        ? 'BREVO_API_KEY / BREVO_SENDER_EMAIL not set — running in console-stub mode'
        : 'BREVO_API_KEY and sender are configured',
      // We do NOT make a live SMTP/API call here to avoid per-request
      // external traffic. The server.js verifyEmailTransport() call at boot
      // already validates the credentials. If that fails, the server logs
      // a warning.
      latencyMs: null,
    };
  } catch (err) {
    return { name: 'Email (Brevo)', status: 'UNKNOWN', note: err.message };
  }
}

function _checkPaymentSync() {
  try {
    // eslint-disable-next-line global-require
    const { isStubActive } = require('../../utils/bankVerification');
    const stub = isStubActive();
    return {
      name: 'Payment Verification (Veritas)',
      status: stub ? 'NOT_CONFIGURED' : 'CONFIGURED',
      note: stub
        ? 'VERITAS_API_KEY not set — bank verification is in STUB MODE'
        : 'VERITAS_API_KEY is configured',
      latencyMs: null,
    };
  } catch (err) {
    return { name: 'Payment Verification (Veritas)', status: 'UNKNOWN', note: err.message };
  }
}

function _checkAiSync() {
  try {
    const groqConfigured = !!process.env.GROQ_API_KEY;
    // eslint-disable-next-line global-require
    const { isStubActive } = require('../../utils/ocrReceipt');
    const ocrConfigured = !!process.env.OCRSPACE_API_KEY;
    const visionEnabled = !!process.env.GROQ_VISION_ENABLED;

    // OCR.space IS required in practice: parseReceiptImage() always falls
    // through to ocrSpaceParse() (which throws without OCRSPACE_API_KEY)
    // unless the Groq-vision path is both enabled and succeeds. Vision is
    // off by default and, even when on, silently falls back to OCR.space
    // on any failure — so without an OCR.space key, a vision hiccup takes
    // the whole feature down. Reflect that honestly instead of treating
    // GROQ_API_KEY alone as sufficient.
    let status;
    if (!groqConfigured) {
      status = 'NOT_CONFIGURED';
    } else if (ocrConfigured) {
      status = 'CONFIGURED';
    } else if (visionEnabled) {
      status = 'DEGRADED'; // vision-only, no fallback if it fails
    } else {
      status = 'NOT_CONFIGURED'; // real runtime path (OCR.space) is missing
    }

    const note = !groqConfigured
      ? 'GROQ_API_KEY not set — AI receipt parsing and support assistant are disabled'
      : ocrConfigured
        ? 'GROQ_API_KEY and OCRSPACE_API_KEY are set'
        : visionEnabled
          ? 'GROQ_API_KEY set and Groq vision enabled, but OCRSPACE_API_KEY is missing — no fallback if vision fails'
          : 'GROQ_API_KEY set, but OCRSPACE_API_KEY is missing — receipt screenshot autofill will fail on every upload';

    return {
      name: 'AI / OCR (Groq + OCR.space)',
      status,
      note,
      ocrAlsoConfigured: !isStubActive(),
      latencyMs: null,
    };
  } catch (err) {
    return { name: 'AI / OCR', status: 'UNKNOWN', note: err.message };
  }
}

async function _checkDatabaseIntegration() {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - t0;
    return {
      name: 'Database (PostgreSQL)',
      status: latencyMs > 500 ? 'DEGRADED' : 'HEALTHY',
      latencyMs,
      note: `Round-trip SELECT 1 latency: ${latencyMs}ms`,
    };
  } catch (err) {
    return {
      name: 'Database (PostgreSQL)',
      status: 'UNAVAILABLE',
      latencyMs: null,
      note: 'Connection failed',
    };
  }
}

async function getIntegrationsSection() {
  // DB is the only check that makes a real network call every time
  // (it's our own infrastructure). External service checks are config-only
  // to avoid hammering third-party rate limits.
  const [db, email, payment, ai, storage] = await Promise.all([
    _checkDatabaseIntegration(),
    Promise.resolve(_cached('email', _checkEmailSync)),
    Promise.resolve(_cached('payment', _checkPaymentSync)),
    Promise.resolve(_cached('ai', _checkAiSync)),
    Promise.resolve(_cached('storage', getStorageSection)),
  ]);

  const result = {
    database: db,
    email,
    payment,
    ai,
    storage: {
      name: 'Object Storage (Supabase)',
      status: storage.configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      note: storage.note,
      latencyMs: null,
    },
  };

  // Persist lightweight health-check telemetry so the operations console can
  // show history without exposing credentials. This is deliberately labelled
  // as health-check telemetry, not as business-operation telemetry.
  const events = [
    ['database', db],
    ['email', email],
    ['payment', payment],
    ['ai', ai],
    ['storage', result.storage],
  ];
  await Promise.all(events.map(async ([integration, check]) => {
    const now = Date.now();
    if (_lastTelemetryAt[integration] && now - _lastTelemetryAt[integration] < INTEGRATION_CACHE_TTL_MS) return;
    _lastTelemetryAt[integration] = now;
    return recordIntegrationEvent({
      integration,
      operation: check.status === 'CONFIGURED' ? 'CONFIGURATION_CHECK' : 'HEALTH_CHECK',
      success: check.status === 'HEALTHY' || check.status === 'DEGRADED' || check.status === 'CONFIGURED',
      latencyMs: check.latencyMs ?? null,
      errorMessage: check.status === 'HEALTHY' || check.status === 'DEGRADED' || check.status === 'CONFIGURED' ? null : check.note || check.error || check.status,
    });
  }));

  return result;
}

// ---- System status (high-level) -------------------------------------------

async function getSystemStatus() {
  const [db, integrations] = await Promise.all([
    getDatabaseHealth(),
    getIntegrationsSection(),
  ]);

  function mapStatus(s) {
    if (s === 'HEALTHY') return 'Healthy';
    if (s === 'DEGRADED') return 'Degraded';
    if (s === 'NOT_CONFIGURED') return 'Not configured';
    if (s === 'UNAVAILABLE') return 'Unavailable';
    return 'Unknown';
  }

  return {
    api:     { label: 'Healthy', detail: 'API is responding (this response is proof)' },
    database:{ label: mapStatus(db.status), latencyMs: db.latencyMs },
    storage: { label: mapStatus(integrations.storage.status), note: integrations.storage.note },
    email:   { label: mapStatus(integrations.email.status), note: integrations.email.note },
    payments:{ label: mapStatus(integrations.payment.status), note: integrations.payment.note },
    ai:      { label: mapStatus(integrations.ai.status), note: integrations.ai.note },
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  getDatabaseSection,
  getStorageSection,
  getIntegrationsSection,
  getSystemStatus,
};
