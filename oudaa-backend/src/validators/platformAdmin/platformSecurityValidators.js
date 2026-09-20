const { z } = require('zod');

const confirmField = z.literal(true, { errorMap: () => ({ message: 'This action requires explicit confirmation (confirm: true)' }) });
const reasonField = z.string().trim().min(3, 'A brief reason is required for this action').max(500);

const updateSecuritySettingsSchema = z.object({
  body: z.object({
    sessionDurationMinutes: z.number().int().min(5).max(129600).optional(), // 5 min .. 90 days
    passwordMinLength: z.number().int().min(8).max(128).optional(),
    passwordRequireUppercase: z.boolean().optional(),
    passwordRequireNumber: z.boolean().optional(),
    passwordRequireSymbol: z.boolean().optional(),
    loginRateLimitMax: z.number().int().min(1).max(1000).optional(),
    loginRateLimitWindowMinutes: z.number().int().min(1).max(1440).optional(),
    mfaRequiredForAllAdmins: z.boolean().optional(),
    trustedOrigins: z.array(z.string().url()).max(50).optional(),
    reason: reasonField,
    confirm: confirmField,
  }),
});

const revokeSessionSchema = z.object({
  body: z.object({
    reason: reasonField.optional(),
    confirm: confirmField,
  }),
});

const listEventsQuerySchema = z.object({
  query: z.object({
    category: z.union([z.string(), z.array(z.string())]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
  }),
});

module.exports = {
  updateSecuritySettingsSchema,
  revokeSessionSchema,
  listEventsQuerySchema,
};
