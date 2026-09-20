const AppError = require('../../utils/AppError');
const { roleHasPermission } = require('../../config/platformPermissions');

/**
 * Restricts a platform-admin route to a specific granular permission
 * (see src/config/platformPermissions.js), resolved from
 * req.platformAdmin.role. Must run after authenticatePlatformAdmin.
 *
 * Usage: router.get('/communities', authenticatePlatformAdmin,
 *   requirePlatformPermission(PLATFORM_PERMISSIONS.COMMUNITIES_VIEW), handler)
 */
module.exports = function requirePlatformPermission(permission) {
  return (req, res, next) => {
    if (!req.platformAdmin) {
      return next(new AppError('Platform authentication required', 401));
    }
    if (!roleHasPermission(req.platformAdmin.role, permission)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
};
