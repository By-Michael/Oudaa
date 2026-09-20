'use strict';

const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');

const SETTINGS_ID = 'default';

const DEFAULTS = Object.freeze({
  id: SETTINGS_ID,
  sessionDurationMinutes: 480,
  passwordMinLength: 12,
  passwordRequireUppercase: true,
  passwordRequireNumber: true,
  passwordRequireSymbol: false,
  loginRateLimitMax: 10,
  loginRateLimitWindowMinutes: 15,
  mfaRequiredForAllAdmins: false,
  trustedOrigins: [],
});

// Read on essentially every authenticated platform request (requireMfa,
// the login rate limiter, password validation), so we keep a short-lived
// in-process cache rather than hitting the DB every time. 5s is long
// enough to matter for load, short enough that a settings change from
// the UI is felt almost immediately — and correctness never depends on
// the cache being instantaneous (these are security *controls*, not
// per-request authorization decisions).
const CACHE_TTL_MS = 5000;
let cached = null;
let cachedAt = 0;

function invalidateCache() {
  cached = null;
  cachedAt = 0;
}

async function getSecuritySettings({ bypassCache = false } = {}) {
  if (!bypassCache && cached && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cached;
  }
  let row;
  try {
    row = await prisma.platformSecuritySettings.findUnique({ where: { id: SETTINGS_ID } });
  } catch (err) {
    // Security controls must fail closed. Falling back to defaults here can
    // accidentally disable a globally-enforced MFA policy during a database
    // outage, which is worse than temporarily returning 503.
    // eslint-disable-next-line no-console
    console.error('Failed to load platform security settings:', err.message);
    throw new AppError('Platform security configuration is temporarily unavailable', 503, { code: 'SECURITY_SETTINGS_UNAVAILABLE' });
  }
  const settings = row ? { ...DEFAULTS, ...row } : DEFAULTS;
  cached = settings;
  cachedAt = Date.now();
  return settings;
}

async function updateSecuritySettings(patch, actorId) {
  const updated = await prisma.platformSecuritySettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...DEFAULTS, ...patch, updatedById: actorId || null },
    update: { ...patch, updatedById: actorId || null },
  });
  invalidateCache();
  return updated;
}

// Synchronous accessor for callers (like the rate limiter, which
// express-rate-limit invokes per-request) that can tolerate a slightly
// stale value but cannot await inline. Always backed by the same cache;
// returns DEFAULTS until the first async load has happened at least once.
function getCachedSecuritySettingsSync() {
  return cached || DEFAULTS;
}

module.exports = {
  DEFAULTS,
  getSecuritySettings,
  updateSecuritySettings,
  invalidateCache,
  getCachedSecuritySettingsSync,
};
