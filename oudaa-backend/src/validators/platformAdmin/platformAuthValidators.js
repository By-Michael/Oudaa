const { z } = require('zod');

const platformLoginSchema = z.object({
  body: z.object({
    email: z.string().trim().email('A valid email is required'),
    password: z.string().min(1, 'Password is required'),
    // Optional 6-digit TOTP code, submitted together with the password
    // when the admin already has MFA enrolled (single round trip rather
    // than a separate "MFA challenge" screen — Phase 1 keeps this simple;
    // the login response tells the frontend when a code is required but
    // wasn't supplied).
    mfaCode: z.string().trim().optional(),
    recoveryCode: z.string().trim().optional(),
  }),
});

const platformRefreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().optional(),
  }),
});

const platformChangePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(12, 'New password must be at least 12 characters'),
  }),
});

const platformMfaVerifySchema = z.object({
  body: z.object({
    token: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
  }),
});

const platformMfaDisableSchema = z.object({
  body: z.object({
    password: z.string().min(1, 'Password is required to disable MFA'),
    token: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
  }),
});

module.exports = {
  platformLoginSchema,
  platformRefreshSchema,
  platformChangePasswordSchema,
  platformMfaVerifySchema,
  platformMfaDisableSchema,
};
