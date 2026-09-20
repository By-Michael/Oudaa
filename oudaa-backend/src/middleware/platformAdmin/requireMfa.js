const AppError = require('../../utils/AppError');
const { isMfaMandatoryForRole } = require('../../config/platformPermissions');
const { getSecuritySettings } = require('../../services/platformAdmin/platformSecuritySettingsService');

/**
 * Requires the current platform-admin session to have completed MFA.
 * Must run after authenticatePlatformAdmin.
 *
 * MFA becomes mandatory for a session for any of three independent
 * reasons, all checked against DB-backed state (never merely a JWT
 * claim):
 *   1. The admin's role hard-requires it (SUPER_ADMIN, SECURITY_AUDITOR —
 *      see platformPermissions.js's MFA_MANDATORY_ROLES). This is a code
 *      constant, not a runtime setting — see that file's header comment.
 *   2. A SUPER_ADMIN has flagged this specific admin for forced
 *      re-enrollment (see platformAdminManagementController.
 *      requireMfaReenrollment) — mfaReenrollmentRequired stays true until
 *      they complete /auth/mfa/enroll/verify again.
 *   3. The operator-controlled security setting mfaRequiredForAllAdmins
 *      is on (see platformSecuritySettingsService) — an ADDITIONAL floor
 *      on top of (1), never a way to loosen it.
 *
 * An admin who must enroll (for any of the above reasons) but hasn't yet
 * is blocked here with a distinct error code so the frontend can route
 * them to enrollment instead of showing an opaque 403.
 */
module.exports = async function requireMfa(req, res, next) {
  if (!req.platformAdmin || !req.platformSession) {
    return next(new AppError('Platform authentication required', 401));
  }

  const { role, mfaEnabled, mfaReenrollmentRequired } = req.platformAdmin;

  let settings;
  try {
    settings = await getSecuritySettings();
  } catch {
    settings = { mfaRequiredForAllAdmins: false };
  }

  const mandatory = isMfaMandatoryForRole(role) || settings.mfaRequiredForAllAdmins;
  const mustEnroll = (mandatory && !mfaEnabled) || mfaReenrollmentRequired;

  if (mustEnroll) {
    return next(new AppError('MFA enrollment is required for this account before continuing', 403, {
      code: 'MFA_ENROLLMENT_REQUIRED',
    }));
  }

  if ((mandatory || mfaEnabled) && !req.platformSession.mfaVerified) {
    return next(new AppError('MFA verification is required for this session', 403, {
      code: 'MFA_VERIFICATION_REQUIRED',
    }));
  }

  next();
};
