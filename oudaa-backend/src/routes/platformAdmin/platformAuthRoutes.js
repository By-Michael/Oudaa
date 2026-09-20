const express = require('express');
const rateLimit = require('express-rate-limit');
const platformAuthController = require('../../controllers/platformAdmin/platformAuthController');
const authenticatePlatformAdmin = require('../../middleware/platformAdmin/authenticatePlatformAdmin');
const requireMfa = require('../../middleware/platformAdmin/requireMfa');
const requireRecentReauthentication = require('../../middleware/platformAdmin/requireRecentReauthentication');
const requireMustChangePassword = require('../../middleware/platformAdmin/requireMustChangePassword');
const { getCachedSecuritySettingsSync, getSecuritySettings } = require('../../services/platformAdmin/platformSecuritySettingsService');
const validate = require('../../middleware/validate');
const {
  platformLoginSchema,
  platformRefreshSchema,
  platformChangePasswordSchema,
  platformMfaVerifySchema,
  platformMfaDisableSchema,
} = require('../../validators/platformAdmin/platformAuthValidators');

const router = express.Router();

// Tighter than the community authLimiter (20/15min in production) — this
// surface guards operator access to every tenant on the platform, so
// brute-force/credential-stuffing tolerance should be lower, not equal.
//
// `max`/`windowMs` are functions (supported by express-rate-limit v8) that
// read the Security Settings row on each request via the sync cache (see
// platformSecuritySettingsService) rather than a value frozen at process
// boot — so changing "login rate limiting" in the Security Center takes
// effect within the cache's ~5s TTL, no restart required. In non-production
// we still fall back to a very high ceiling so the existing test suite
// (which fires many login attempts deliberately) isn't affected unless a
// test explicitly writes tighter settings.
async function warmSecuritySettingsCache() {
  try { await getSecuritySettings(); } catch { /* best-effort */ }
}
warmSecuritySettingsCache();

const platformAuthLimiter = rateLimit({
  windowMs: () => {
    if (process.env.NODE_ENV !== 'production') return 15 * 60 * 1000;
    return getCachedSecuritySettingsSync().loginRateLimitWindowMinutes * 60 * 1000;
  },
  max: () => {
    if (process.env.NODE_ENV !== 'production') return 5000;
    return getCachedSecuritySettingsSync().loginRateLimitMax;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later' },
});

router.post('/login', platformAuthLimiter, validate(platformLoginSchema), platformAuthController.login);
router.post('/refresh', platformAuthLimiter, validate(platformRefreshSchema), platformAuthController.refresh);
router.post('/logout', platformAuthController.logout);

router.get('/me', authenticatePlatformAdmin, platformAuthController.me);

router.post(
  '/logout-all',
  authenticatePlatformAdmin,
  requireMustChangePassword,
  platformAuthController.logoutAllSessions
);

router.patch(
  '/change-password',
  authenticatePlatformAdmin,
  requireRecentReauthentication(30),
  platformAuthLimiter,
  validate(platformChangePasswordSchema),
  platformAuthController.changePassword
);

// MFA enrollment does not require requireMfa (that would be circular —
// you can't be blocked by "MFA not verified" while trying to enroll it),
// but does require a fresh login (requireRecentReauthentication) since
// enrolling MFA changes the account's security posture.
router.post(
  '/mfa/enroll/start',
  authenticatePlatformAdmin,
  requireMustChangePassword,
  requireRecentReauthentication(30),
  platformAuthController.mfaEnrollStart
);
router.post(
  '/mfa/enroll/verify',
  authenticatePlatformAdmin,
  requireMustChangePassword,
  requireRecentReauthentication(30),
  validate(platformMfaVerifySchema),
  platformAuthController.mfaEnrollVerify
);
router.post(
  '/mfa/disable',
  authenticatePlatformAdmin,
  requireMustChangePassword,
  requireMfa,
  requireRecentReauthentication(30),
  validate(platformMfaDisableSchema),
  platformAuthController.mfaDisable
);

module.exports = router;
