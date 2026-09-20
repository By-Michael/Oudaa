const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Deliberately separate secrets from the community-side utils/tokens.js.
// A leaked community JWT secret (or a bug that reuses one signer for both)
// must never let anyone forge a platform-admin token, and vice versa.
// Falls back to the community secrets are NEVER used here on purpose —
// if PLATFORM_JWT_* is unset, signing/verifying simply fails loudly rather
// than silently reusing a different trust boundary's key.
function getAccessSecret() {
  const secret = process.env.PLATFORM_JWT_ACCESS_SECRET;
  if (!secret) throw new Error('PLATFORM_JWT_ACCESS_SECRET is not configured');
  return secret;
}

function getRefreshSecret() {
  const secret = process.env.PLATFORM_JWT_REFRESH_SECRET;
  if (!secret) throw new Error('PLATFORM_JWT_REFRESH_SECRET is not configured');
  return secret;
}

// Short-lived by design — platform-admin access tokens live for minutes,
// not the 30m community default, since a leaked one is far more sensitive.
const ACCESS_EXPIRES_IN = process.env.PLATFORM_JWT_ACCESS_EXPIRES_IN || '10m';
const REFRESH_EXPIRES_IN = process.env.PLATFORM_JWT_REFRESH_EXPIRES_IN || '8h';
const REFRESH_EXPIRES_MS = parseExpiryToMs(REFRESH_EXPIRES_IN);

function parseExpiryToMs(value) {
  const match = /^(\d+)([smhd])$/.exec(String(value).trim());
  if (!match) return 8 * 60 * 60 * 1000; // fallback: 8h
  const n = Number(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return n * multipliers[unit];
}

/**
 * @param {object} admin - PlatformAdmin row
 * @param {object} session - PlatformAdminSession row (must already exist)
 */
function signPlatformAccessToken(admin, session) {
  return jwt.sign(
    {
      sub: admin.id,
      role: admin.role,
      sid: session.id,
      mfaVerified: !!session.mfaVerified,
      // Authentication time backing requireRecentReauthentication — read
      // from the session row, not recomputed, so refreshing an access
      // token never silently extends how "fresh" the login looks.
      authTime: Math.floor(new Date(session.authenticatedAt).getTime() / 1000),
      typ: 'platform_access',
    },
    getAccessSecret(),
    { expiresIn: ACCESS_EXPIRES_IN }
  );
}

function signPlatformRefreshToken(admin, session, expiresInSeconds = REFRESH_EXPIRES_IN) {
  return jwt.sign(
    { sub: admin.id, sid: session.id, typ: 'platform_refresh' },
    getRefreshSecret(),
    { expiresIn: expiresInSeconds }
  );
}

function verifyPlatformAccessToken(token) {
  const payload = jwt.verify(token, getAccessSecret());
  if (payload.typ !== 'platform_access') throw new Error('Wrong token type');
  return payload;
}

function verifyPlatformRefreshToken(token) {
  const payload = jwt.verify(token, getRefreshSecret());
  if (payload.typ !== 'platform_refresh') throw new Error('Wrong token type');
  return payload;
}

// Only a hash is ever persisted (see PlatformAdminSession.tokenHash) — same
// pattern as the community side's RefreshToken, so a DB leak alone can't be
// replayed as a valid session.
function hashPlatformToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  ACCESS_EXPIRES_IN,
  REFRESH_EXPIRES_IN,
  REFRESH_EXPIRES_MS,
  signPlatformAccessToken,
  signPlatformRefreshToken,
  verifyPlatformAccessToken,
  verifyPlatformRefreshToken,
  hashPlatformToken,
};
