const AppError = require('../../utils/AppError');
const { verifyPlatformAccessToken } = require('../../utils/platformTokens');
const prisma = require('../../config/prisma');

/**
 * Verifies the platform-admin Bearer access token and attaches
 * req.platformAdmin (id, role, email, fullName) + req.platformSession
 * (id, mfaVerified, authenticatedAt). This is a completely separate
 * authentication boundary from middleware/authenticate.js — a community
 * User's token will never verify here (different secret entirely), and a
 * platform-admin token will never verify against the community
 * middleware, so neither can be used to impersonate the other by mistake
 * or by frontend route manipulation.
 *
 * Also re-checks isActive and session validity on every request (not just
 * at login), so disabling an operator or revoking a session takes effect
 * immediately rather than waiting for their access token to expire.
 */
module.exports = async function authenticatePlatformAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new AppError('Platform authentication required', 401);
    }

    let payload;
    try {
      payload = verifyPlatformAccessToken(token);
    } catch (err) {
      throw new AppError('Invalid or expired platform access token', 401);
    }

    const [admin, session] = await Promise.all([
      prisma.platformAdmin.findUnique({ where: { id: payload.sub } }),
      prisma.platformAdminSession.findUnique({ where: { id: payload.sid } }),
    ]);

    if (!admin) throw new AppError('Platform admin no longer exists', 401);
    if (!admin.isActive) throw new AppError('This platform admin account has been disabled', 403);
    if (!session || session.revoked || session.expiresAt < new Date()) {
      throw new AppError('Platform session is no longer valid', 401);
    }
    if (session.platformAdminId !== admin.id) {
      // Defense in depth: a token whose sid doesn't actually belong to the
      // admin it claims (should be impossible given signing, but never
      // trust a claim without cross-checking the row it points at).
      throw new AppError('Invalid platform session', 401);
    }

    // Best-effort — a failed "touch" must never block the request.
    prisma.platformAdminSession
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    req.platformAdmin = {
      id: admin.id,
      role: admin.role,
      email: admin.email,
      fullName: admin.fullName,
      mfaEnabled: admin.mfaEnabled,
      mustChangePassword: admin.mustChangePassword,
      mfaReenrollmentRequired: admin.mfaReenrollmentRequired,
    };
    req.platformSession = {
      id: session.id,
      // The token's own mfaVerified/authTime claims are trusted for
      // performance, but always same-value as the session row at issuance
      // time — requireMfa/requireRecentReauthentication re-derive from the
      // session row itself below for anything security-sensitive.
      mfaVerified: session.mfaVerified,
      authenticatedAt: session.authenticatedAt,
    };

    next();
  } catch (err) {
    next(err);
  }
};
