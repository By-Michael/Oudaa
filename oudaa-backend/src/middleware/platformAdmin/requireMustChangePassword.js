const AppError = require('../../utils/AppError');

/**
 * Blocks every protected platform-admin route for an admin who has been
 * flagged by a SUPER_ADMIN via POST /platform-admins/:id/require-password-reset
 * (see platformAdminManagementController.requirePasswordReset), until they
 * change their password through PATCH /auth/change-password — which does
 * NOT include this middleware in its chain, so the admin always has a way
 * out. Mirrors requireMfa's "narrow escape hatch" shape.
 *
 * Must run after authenticatePlatformAdmin.
 */
module.exports = function requireMustChangePassword(req, res, next) {
  if (!req.platformAdmin) {
    return next(new AppError('Platform authentication required', 401));
  }
  if (req.platformAdmin.mustChangePassword) {
    return next(new AppError(
      'A password reset has been required for this account before you can continue.',
      403,
      { code: 'PASSWORD_RESET_REQUIRED' }
    ));
  }
  next();
};
