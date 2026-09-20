'use strict';

/**
 * Every PlatformAuditLog `action` value this app writes, in one place, so
 * the Security Center's category filter (SECURITY_EVENT_CATEGORIES below)
 * and the "recent privileged operations" list (PRIVILEGED_ACTIONS) can't
 * silently drift out of sync with what controllers actually record. Not
 * enforced at the DB layer (action is a plain string column, same as the
 * community-side AuditLog) — this is a code-review aid, not a constraint.
 */
const PLATFORM_AUDIT_ACTIONS = Object.freeze({
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  SESSION_REVOKED: 'SESSION_REVOKED', // "revoke all my sessions" (self)
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  MFA_ENABLED: 'MFA_ENABLED',
  MFA_DISABLED: 'MFA_DISABLED',

  USER_VIEWED: 'USER_VIEWED',
  USER_SESSIONS_REVOKED: 'USER_SESSIONS_REVOKED',
  SUPPORT_VIEW_STARTED: 'SUPPORT_VIEW_STARTED',
  SUPPORT_VIEW_ENDED: 'SUPPORT_VIEW_ENDED',

  // Phase 6 — platform-admin-identity management
  ADMIN_CREATED: 'ADMIN_CREATED',
  ADMIN_ENABLED: 'ADMIN_ENABLED',
  ADMIN_DISABLED: 'ADMIN_DISABLED',
  ADMIN_ROLE_CHANGED: 'ADMIN_ROLE_CHANGED',
  ADMIN_ROLE_CHANGE_DENIED: 'ADMIN_ROLE_CHANGE_DENIED',
  ADMIN_PASSWORD_RESET_REQUIRED: 'ADMIN_PASSWORD_RESET_REQUIRED',
  ADMIN_MFA_REENROLLMENT_REQUIRED: 'ADMIN_MFA_REENROLLMENT_REQUIRED',
  ADMIN_SESSION_REVOKED: 'ADMIN_SESSION_REVOKED',
  ADMIN_SESSIONS_REVOKED: 'ADMIN_SESSIONS_REVOKED',
  ADMIN_ACTIVITY_VIEWED: 'ADMIN_ACTIVITY_VIEWED',

  // Phase 6 — security settings / privileged config
  SECURITY_SETTINGS_UPDATED: 'SECURITY_SETTINGS_UPDATED',
});

// Shown in the "Recent privileged operations" panel of the Security
// dashboard — anything that changes another admin's access, another
// admin's or the platform's own security posture, or ends a session that
// wasn't the actor's own.
const PRIVILEGED_ACTIONS = Object.freeze([
  PLATFORM_AUDIT_ACTIONS.ADMIN_CREATED,
  PLATFORM_AUDIT_ACTIONS.ADMIN_ENABLED,
  PLATFORM_AUDIT_ACTIONS.ADMIN_DISABLED,
  PLATFORM_AUDIT_ACTIONS.ADMIN_ROLE_CHANGED,
  PLATFORM_AUDIT_ACTIONS.ADMIN_ROLE_CHANGE_DENIED,
  PLATFORM_AUDIT_ACTIONS.ADMIN_PASSWORD_RESET_REQUIRED,
  PLATFORM_AUDIT_ACTIONS.ADMIN_MFA_REENROLLMENT_REQUIRED,
  PLATFORM_AUDIT_ACTIONS.ADMIN_SESSION_REVOKED,
  PLATFORM_AUDIT_ACTIONS.ADMIN_SESSIONS_REVOKED,
  PLATFORM_AUDIT_ACTIONS.SECURITY_SETTINGS_UPDATED,
  PLATFORM_AUDIT_ACTIONS.USER_SESSIONS_REVOKED,
  PLATFORM_AUDIT_ACTIONS.SUPPORT_VIEW_STARTED,
  PLATFORM_AUDIT_ACTIONS.MFA_DISABLED,
]);

// Failure "reason" codes recorded in PlatformAuditLog.metadata.reason for
// LOGIN_FAILED entries (see platformAuthController) that indicate the
// attempt targeted something other than "a real active account, wrong
// password" — i.e. more likely to be an enumeration/credential-stuffing
// probe than an operator mistyping their own password.
const UNUSUAL_LOGIN_REASONS = Object.freeze(['unknown_email', 'account_locked', 'account_disabled']);

// Category -> matcher used by GET /security/events (see
// platformSecurityController.listEvents). Each matcher receives a
// PlatformAuditLog row (already loaded) and returns true/false, rather
// than trying to express every category as a single Prisma `where`,
// because a couple of these (UNUSUAL_LOGIN, FAILED_PRIVILEGED_OPERATION)
// depend on combinations of action + success + metadata that don't map
// to one column.
const SECURITY_EVENT_CATEGORIES = {
  LOGIN_FAILURE: {
    label: 'Login failure',
    where: { action: PLATFORM_AUDIT_ACTIONS.LOGIN_FAILED },
  },
  UNUSUAL_LOGIN: {
    label: 'Unusual login',
    // Prisma's JSON path filtering supports `equals`, not `in`, so an
    // "any of these reasons" filter has to be expressed as an OR of
    // single-value equals checks rather than one `in` clause.
    where: {
      action: PLATFORM_AUDIT_ACTIONS.LOGIN_FAILED,
      OR: UNUSUAL_LOGIN_REASONS.map((reason) => ({ metadata: { path: ['reason'], equals: reason } })),
    },
  },
  PRIVILEGE_CHANGE: {
    label: 'Privilege change',
    where: { action: { in: [PLATFORM_AUDIT_ACTIONS.ADMIN_ROLE_CHANGED, PLATFORM_AUDIT_ACTIONS.ADMIN_ROLE_CHANGE_DENIED] } },
  },
  PERMISSION_CHANGE: {
    label: 'Permission change',
    // Role changes are how permissions change in this system (permission
    // sets are per-role, not per-admin — see config/platformPermissions.js),
    // so this category currently mirrors PRIVILEGE_CHANGE. Kept as its own
    // filter option because the spec calls them out separately, and this
    // is the seam where a future per-admin permission override would hook in.
    where: { action: { in: [PLATFORM_AUDIT_ACTIONS.ADMIN_ROLE_CHANGED, PLATFORM_AUDIT_ACTIONS.ADMIN_ROLE_CHANGE_DENIED] } },
  },
  SESSION_REVOCATION: {
    label: 'Session revocation',
    where: {
      action: {
        in: [
          PLATFORM_AUDIT_ACTIONS.SESSION_REVOKED,
          PLATFORM_AUDIT_ACTIONS.ADMIN_SESSION_REVOKED,
          PLATFORM_AUDIT_ACTIONS.ADMIN_SESSIONS_REVOKED,
          PLATFORM_AUDIT_ACTIONS.USER_SESSIONS_REVOKED,
        ],
      },
    },
  },
  IMPERSONATION: {
    label: 'Impersonation',
    where: { action: { in: [PLATFORM_AUDIT_ACTIONS.SUPPORT_VIEW_STARTED, PLATFORM_AUDIT_ACTIONS.SUPPORT_VIEW_ENDED] } },
  },
  SENSITIVE_CONFIG_CHANGE: {
    label: 'Sensitive configuration change',
    where: { action: PLATFORM_AUDIT_ACTIONS.SECURITY_SETTINGS_UPDATED },
  },
  FAILED_PRIVILEGED_OPERATION: {
    label: 'Failed privileged operation',
    where: { action: { in: PRIVILEGED_ACTIONS }, success: false },
  },
};

module.exports = {
  PLATFORM_AUDIT_ACTIONS,
  PRIVILEGED_ACTIONS,
  UNUSUAL_LOGIN_REASONS,
  SECURITY_EVENT_CATEGORIES,
};
