require('dotenv').config();
const app = require('./app');
const prisma = require('./config/prisma');
const { isStubActive } = require('./utils/bankVerification');
const { isStubActive: isEmailStubActive, verifyEmailTransport } = require('./utils/email');
const { isSupabaseConfigured } = require('./config/storage');
const { isStubActive: isOcrStubActive } = require('./utils/ocrReceipt');
const { isStubActive: isGroqStubActive } = require('./utils/groqReceiptParser');
// Phase 5: background metric snapshot collector.
const { collectAndStoreSnapshot, SNAPSHOT_INTERVAL_MS } = require('./services/platformAdmin/platformMetricsService');
const { startWorker: startPlatformExportWorker, cleanupExpiredJobs } = require('./services/platformAdmin/platformExportService');
const { cleanupTelemetry } = require('./services/platformAdmin/platformTelemetryRetentionService');

const PORT = process.env.PORT || 4000;


function assertProductionConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;
  const required = [
    ['DATABASE_URL', 1],
    ['CORS_ORIGIN', 1],
    ['PLATFORM_ADMIN_CORS_ORIGIN', 1],
    ['JWT_ACCESS_SECRET', 32],
    ['JWT_REFRESH_SECRET', 32],
    ['PLATFORM_JWT_ACCESS_SECRET', 32],
    ['PLATFORM_JWT_REFRESH_SECRET', 32],
    ['PLATFORM_MFA_ENCRYPTION_KEY', 32],
    ['FRONTEND_URL', 1],
  ];
  const missing = [];
  const weak = [];
  for (const [name, minLength] of required) {
    const value = String(process.env[name] || '');
    if (!value) missing.push(name);
    else if (value.length < minLength) weak.push(name);
  }

  if (missing.length || weak.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (weak.length) parts.push(`too short: ${weak.join(', ')}`);
    throw new Error(`Production configuration check failed — ${parts.join('; ')}.`);
  }

  if (process.env.PLATFORM_JWT_ACCESS_SECRET === process.env.JWT_ACCESS_SECRET ||
      process.env.PLATFORM_JWT_REFRESH_SECRET === process.env.JWT_REFRESH_SECRET) {
    throw new Error('Production configuration check failed — platform JWT secrets must be different from community JWT secrets.');
  }

  if (!isSupabaseConfigured && process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION !== 'true') {
    throw new Error('Production configuration check failed — Supabase storage is required for persistent receipt uploads. Set ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true only when the deployment has durable persistent storage.');
  }

  if (isStubActive() && process.env.ALLOW_PAYMENT_VERIFICATION_STUB_IN_PRODUCTION !== 'true') {
    throw new Error('Production configuration check failed — VERITAS_API_KEY is not configured. Refusing to start with payment verification in STUB mode.');
  }

  if (!String(process.env.PLATFORM_EXPORT_DIR || '').trim()) {
    throw new Error('Production configuration check failed — PLATFORM_EXPORT_DIR must point to durable storage for platform export files.');
  }
}

assertProductionConfiguration();

if (isStubActive()) {
  const banner = [
    '',
    '#############################################################',
    '#  WARNING: VERITAS_API_KEY is not set.                     #',
    '#  Bank transaction verification is running in STUB MODE —  #',
    '#  self-verified resident payments are NOT being checked    #',
    '#  against a real bank. Do not run this way in production.  #',
    '#############################################################',
    '',
  ].join('\n');
  if (process.env.NODE_ENV === 'production') {
    console.error(banner);
  } else {
    console.warn(banner);
  }
}

if (isEmailStubActive()) {
  const banner = [
    '',
    '#############################################################',
    '#  WARNING: BREVO_API_KEY / BREVO_SENDER_EMAIL not set.      #',
    '#  Outbound email (password resets, deactivation notices,   #',
    '#  etc.) is running in STUB MODE — emails are only logged   #',
    '#  to the console, never actually sent. Password-reset      #',
    '#  links will NOT reach real users while this is active.    #',
    '#  Set BREVO_API_KEY / BREVO_SENDER_EMAIL / BREVO_SENDER_NAME#',
    '#  before relying on email in production.                    #',
    '#############################################################',
    '',
  ].join('\n');
  if (process.env.NODE_ENV === 'production') {
    console.error(banner);
  } else {
    console.warn(banner);
  }
} else {
  // Brevo creds are present — verify they actually authenticate, rather
  // than waiting for the first real password-reset request to find out.
  verifyEmailTransport();
}

if (!isSupabaseConfigured) {
  const banner = [
    '',
    '#############################################################',
    '#  WARNING: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.#',
    '#  Receipt uploads are being written to local disk, which   #',
    '#  is WIPED on every deploy/restart on Render. Every         #',
    '#  receipt uploaded this way will 404 after the next deploy.#',
    '#  Set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY before       #',
    '#  relying on receipt uploads in production.                 #',
    '#############################################################',
    '',
  ].join('\n');
  if (process.env.NODE_ENV === 'production') {
    console.error(banner);
  } else {
    console.warn(banner);
  }
}

if (isOcrStubActive()) {
  const banner = [
    '',
    '#############################################################',
    '#  WARNING: Neither GROQ_API_KEY nor OCRSPACE_API_KEY is set. #',
    '#  Receipt-screenshot autofill is DISABLED — any attempt to  #',
    '#  use it will fail with an error (this is not a silent      #',
    '#  mock, it hard-fails). Set GROQ_API_KEY (preferred, vision- #',
    '#  based, no OCR.space dependency) or OCRSPACE_API_KEY.       #',
    '#############################################################',
    '',
  ].join('\n');
  if (process.env.NODE_ENV === 'production') {
    console.error(banner);
  } else {
    console.warn(banner);
  }
}

if (isGroqStubActive()) {
  const banner = [
    '',
    '#############################################################',
    '#  WARNING: GROQ_API_KEY is not set.                         #',
    '#  Receipt autofill is running in REGEX-ONLY mode — only     #',
    '#  transaction ID and sender name are extracted; amount,     #',
    '#  bank name, and date will NOT be autofilled. Set           #',
    '#  GROQ_API_KEY for full structured extraction.              #',
    '#############################################################',
    '',
  ].join('\n');
  if (process.env.NODE_ENV === 'production') {
    console.warn(banner);
  } else {
    console.warn(banner);
  }
}

const server = app.listen(PORT, () => {
  console.log(`Oudaa backend listening on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

// Phase 5: collect a metric snapshot every SNAPSHOT_INTERVAL_MS (5 minutes).
// The collector itself is dedup-safe across multiple Node processes (it
// checks for a recent snapshot before writing). We use setInterval rather
// than a worker thread so the snapshot runs in the same event loop that
// already has an open Prisma connection — no additional connection needed.
// The interval handle is deliberately not stored: it is cleaned up
// automatically when the process exits via the shutdown handlers below.
const _metricsInterval = setInterval(collectAndStoreSnapshot, SNAPSHOT_INTERVAL_MS);
// Prevent the interval from keeping the process alive after an intentional
// shutdown signal — unref() makes Node treat it as a non-blocking timer.
if (_metricsInterval.unref) _metricsInterval.unref();

// Phase 7: queued export worker. Export creation only enqueues a durable job;
// file generation happens outside the request lifecycle.
startPlatformExportWorker();
cleanupExpiredJobs().catch(() => {});
cleanupTelemetry().catch(() => {});
setInterval(() => { cleanupTelemetry().catch(() => {}); }, 24 * 60 * 60 * 1000).unref?.();
const _exportCleanupInterval = setInterval(() => { cleanupExpiredJobs().catch(() => {}); }, 10 * 60 * 1000);
if (_exportCleanupInterval.unref) _exportCleanupInterval.unref();

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});
