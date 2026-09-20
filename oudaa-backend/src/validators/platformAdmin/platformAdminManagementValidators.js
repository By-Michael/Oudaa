const { z } = require('zod');
const { ASSIGNABLE_ROLES } = require('../../config/platformPermissions');

// Every mutating endpoint in this file requires `confirm: true` verbatim
// (not just any truthy value) — a deliberate, hard-to-fat-finger
// confirmation step for high-risk actions, on top of the permission +
// recent-reauthentication checks already enforced by middleware. `reason`
// is required wherever the action affects another operator's account, so
// the audit trail captures WHY, not just what/who/when.
const confirmField = z.literal(true, { errorMap: () => ({ message: 'This action requires explicit confirmation (confirm: true)' }) });
const reasonField = z.string().trim().min(3, 'A brief reason is required for this action').max(500);

const createPlatformAdminSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    password: z.string().min(1),
    role: z.enum(ASSIGNABLE_ROLES),
    confirm: confirmField,
  }),
});

const changeRoleSchema = z.object({
  body: z.object({
    role: z.enum(ASSIGNABLE_ROLES),
    reason: reasonField,
    confirm: confirmField,
  }),
});

const setActiveStatusSchema = z.object({
  body: z.object({
    reason: reasonField,
    confirm: confirmField,
  }),
});

const requirePasswordResetSchema = z.object({
  body: z.object({
    reason: reasonField.optional(),
    confirm: confirmField,
  }),
});

const requireMfaReenrollmentSchema = z.object({
  body: z.object({
    reason: reasonField.optional(),
    confirm: confirmField,
  }),
});

const revokeAdminSessionsSchema = z.object({
  body: z.object({
    reason: reasonField.optional(),
    confirm: confirmField,
  }),
});

module.exports = {
  createPlatformAdminSchema,
  changeRoleSchema,
  setActiveStatusSchema,
  requirePasswordResetSchema,
  requireMfaReenrollmentSchema,
  revokeAdminSessionsSchema,
};
