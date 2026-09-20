const AppError = require('../../utils/AppError');

/**
 * Requires the current session to have (re-)authenticated within the last
 * `maxAgeMinutes` minutes — i.e. a genuine password(+MFA) login, not just
 * a refreshed access token riding on an old session. Intended for the
 * most sensitive actions (changing another admin's role, revoking all
 * sessions platform-wide, disabling MFA, etc.) as a "step-up" style guard.
 *
 * Must run after authenticatePlatformAdmin. Reads authenticatedAt from
 * req.platformSession, which is populated from the PlatformAdminSession
 * row itself (see authenticatePlatformAdmin) — refreshing the access
 * token never advances this value, only a fresh /auth/login does.
 *
 * Usage: router.post('/admins/:id/role', authenticatePlatformAdmin,
 *   requireRecentReauthentication(15), requirePlatformPermission(...), handler)
 */
module.exports = function requireRecentReauthentication(maxAgeMinutes = 15) {
  return (req, res, next) => {
    if (!req.platformSession) {
      return next(new AppError('Platform authentication required', 401));
    }
    const authenticatedAt = new Date(req.platformSession.authenticatedAt).getTime();
    const ageMs = Date.now() - authenticatedAt;
    if (Number.isNaN(authenticatedAt) || ageMs > maxAgeMinutes * 60 * 1000) {
      return next(new AppError(
        `Please sign in again to confirm this action (re-authentication required every ${maxAgeMinutes} minutes for sensitive actions).`,
        401,
        { code: 'REAUTHENTICATION_REQUIRED' }
      ));
    }
    next();
  };
};
