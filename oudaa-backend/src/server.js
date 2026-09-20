require('dotenv').config();
const app = require('./app');
const prisma = require('./config/prisma');
const { isStubActive } = require('./utils/bankVerification');
const { isStubActive: isEmailStubActive, verifyEmailTransport } = require('./utils/email');
const { isSupabaseConfigured } = require('./config/storage');
const { isStubActive: isOcrStubActive } = require('./utils/ocrReceipt');
const { isStubActive: isGroqStubActive } = require('./utils/groqReceiptParser');
const { collectAndStoreSnapshot, SNAPSHOT_INTERVAL_MS } = require('./services/platformAdmin/platformMetricsService');
const { startWorker: startPlatformExportWorker, cleanupExpiredJobs } = require('./services/platformAdmin/platformExportService');
const { cleanupTelemetry } = require('./services/platformAdmin/platformTelemetryRetentionService');

const PORT = process.env.PORT || 4000;


function assertProductionConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;

  const coreRequired = [
    ['DATABASE_URL', 1],
    ['CORS_ORIGIN', 1],
    ['JWT_ACCESS_SECRET', 32],
    ['JWT_REFRESH_SECRET', 32],
    ['FRONTEND_URL', 1],
  ];
  const missing = [];
  const weak = [];
  for (const [name, minLength] of coreRequired) {
    const value = String(process.env[name] || '');
    if (!value) missing.push(name);
    else if (value.length < minLength) weak.push(name);
  }

  const platformEnabled = String(process.env.PLATFORM_ADMIN_ENABLED || '').toLowerCase() === 'true';
  if (platformEnabled) {
    const platformRequired = [
      ['PLATFORM_JWT_ACCESS_SECRET', 32],
      ['PLATFORM_JWT_REFRESH_SECRET', 32],
      ['PLATFORM_MFA_ENCRYPTION_KEY', 32],
    ];
    for (const [name, minLength] of platformRequired) {
      const value = String(process.env[name] || '');
      if (!value) missing.push(name);
      else if (value.length < minLength) weak.push(name);
    }
    if (process.env.PLATFORM_JWT_ACCESS_SECRET === process.env.JWT_ACCESS_SECRET ||
        process.env.PLATFORM_JWT_REFRESH_SECRET === process.env.JWT_REFRESH_SECRET) {
      throw new Error('Production configuration check failed — platform JWT secrets must be different from community JWT secrets.');
    }
    if (!isSupabaseConfigured) {
      throw new Error('Production configuration check failed — Supabase Storage is required when PLATFORM_ADMIN_ENABLED=true (Render Free has no persistent disk).');
    }
  }

  if (missing.length || weak.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (weak.length) parts.push(`too short: ${weak.join(', ')}`);
    throw new Error(`Production configuration check failed — ${parts.join('; ')}.`);
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


// Platform-operations background tasks are non-blocking and use the same
// Prisma connection as the API. They are safe when the admin console is not
// enabled; export jobs simply remain unavailable without the required
// platform configuration.
const _metricsInterval = setInterval(() => {
  collectAndStoreSnapshot().catch((err) => console.error('Platform metrics snapshot failed:', err?.message || err));
}, SNAPSHOT_INTERVAL_MS);
if (_metricsInterval.unref) _metricsInterval.unref();

startPlatformExportWorker();
cleanupExpiredJobs().catch(() => {});
cleanupTelemetry().catch(() => {});
const _telemetryCleanupInterval = setInterval(() => { cleanupTelemetry().catch(() => {}); }, 24 * 60 * 60 * 1000);
if (_telemetryCleanupInterval.unref) _telemetryCleanupInterval.unref();
const _exportCleanupInterval = setInterval(() => { cleanupExpiredJobs().catch(() => {}); }, 10 * 60 * 1000);
if (_exportCleanupInterval.unref) _exportCleanupInterval.unref();

async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});
