process.env.PLATFORM_MFA_ENCRYPTION_KEY = 'unit-test-mfa-key-not-for-prod';

const {
  generateTotpSecret,
  verifyTotp,
  encryptMfaSecret,
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  buildOtpAuthUrl,
  currentTotp,
} = require('../../src/utils/platformMfa');

describe('platformMfa TOTP', () => {
  it('generates a base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThan(20);
  });

  it('verifies a code generated for the current time step', () => {
    const secret = generateTotpSecret();
    const validCode = currentTotp(secret);
    expect(verifyTotp(secret, validCode)).toBe(true);
  });

  it('rejects a code from the wrong secret', () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const codeForB = currentTotp(secretB);
    expect(verifyTotp(secretA, codeForB)).toBe(false);
  });

  it('rejects non-6-digit input outright', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, '12345')).toBe(false);
    expect(verifyTotp(secret, 'abcdef')).toBe(false);
    expect(verifyTotp(secret, '')).toBe(false);
    expect(verifyTotp(secret, undefined)).toBe(false);
  });

  it('builds a valid otpauth:// URL', () => {
    const secret = generateTotpSecret();
    const url = buildOtpAuthUrl({ secret, accountEmail: 'ops@hivee.local' });
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain(encodeURIComponent('ops@hivee.local'));
    expect(url).toContain(`secret=${secret}`);
  });
});

describe('platformMfa secret encryption at rest', () => {
  it('round-trips a secret through encrypt/decrypt', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret); // never stored in plaintext
    expect(decryptMfaSecret(encrypted)).toBe(secret);
  });

  it('produces different ciphertext for the same secret each time (random IV)', () => {
    const secret = generateTotpSecret();
    const a = encryptMfaSecret(secret);
    const b = encryptMfaSecret(secret);
    expect(a).not.toEqual(b);
    expect(decryptMfaSecret(a)).toBe(secret);
    expect(decryptMfaSecret(b)).toBe(secret);
  });

  it('fails to decrypt with a tampered ciphertext', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret);
    const [iv, tag, data] = encrypted.split('.');
    const tampered = [iv, tag, Buffer.from('tampered-data').toString('base64')].join('.');
    expect(() => decryptMfaSecret(tampered)).toThrow();
  });
});

describe('platformMfa recovery codes', () => {
  it('generates the requested number of unique codes', () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });

  it('hashes consistently regardless of case/whitespace', () => {
    const code = generateRecoveryCodes(1)[0];
    const h1 = hashRecoveryCode(code);
    const h2 = hashRecoveryCode(`  ${code.toLowerCase()}  `);
    expect(h1).toBe(h2);
  });

  it('produces a different hash for a different code', () => {
    const [a, b] = generateRecoveryCodes(2);
    expect(hashRecoveryCode(a)).not.toBe(hashRecoveryCode(b));
  });
});
