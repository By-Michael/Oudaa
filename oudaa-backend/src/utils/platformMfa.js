const crypto = require('crypto');

/**
 * Minimal TOTP (RFC 6238) + secret-at-rest encryption for platform-admin
 * MFA. Deliberately dependency-free (Node's built-in crypto only) rather
 * than pulling in an external TOTP/QR package for this foundation phase —
 * standard 30s-step, 6-digit, SHA-1 TOTP, compatible with Google
 * Authenticator / Authy / 1Password etc.
 */

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
// How many steps of clock drift either side to tolerate when verifying.
const TOTP_WINDOW = 1;

function getMfaEncryptionKey() {
  const raw = process.env.PLATFORM_MFA_ENCRYPTION_KEY;
  if (!raw) throw new Error('PLATFORM_MFA_ENCRYPTION_KEY is not configured');
  // Accept either a 32-byte hex string or any string, hashed down to 32
  // bytes — forgiving of how the operator generated it, while still
  // always landing on a valid AES-256 key length.
  return crypto.createHash('sha256').update(raw).digest();
}

// Base32 (RFC 4648, no padding) — TOTP secrets are conventionally shown to
// users in base32 so they can be typed into an authenticator app manually.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160-bit secret
}

function totpAt(base32Secret, counter) {
  const key = base32Decode(base32Secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

function verifyTotp(base32Secret, token) {
  if (!/^\d{6}$/.test(String(token || ''))) return false;
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    const candidate = totpAt(base32Secret, counter + drift);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(String(token)))) {
      return true;
    }
  }
  return false;
}

function buildOtpAuthUrl({ secret, accountEmail, issuer = 'Oudaa Platform Admin' }) {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --- secret-at-rest encryption (AES-256-GCM) ---

function encryptMfaSecret(plainBase32Secret) {
  const key = getMfaEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBase32Secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptMfaSecret(stored) {
  const key = getMfaEncryptionKey();
  const [ivB64, tagB64, dataB64] = String(stored).split('.');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// --- recovery codes ---

function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // xxxx-xxxx format, easy to read/type once, never shown again.
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

// Exposed for tests only — lets test code compute "what would a real
// authenticator app show right now" without re-implementing TOTP, so
// verifyTotp's happy path (not just its rejection paths) is exercised.
function currentTotp(base32Secret) {
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  return totpAt(base32Secret, counter);
}

module.exports = {
  generateTotpSecret,
  verifyTotp,
  buildOtpAuthUrl,
  encryptMfaSecret,
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  currentTotp,
};
