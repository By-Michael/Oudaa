const express = require('express');
const rateLimit = require('express-rate-limit');
const platformSearchController = require('../../controllers/platformAdmin/platformSearchController');
const authenticatePlatformAdmin = require('../../middleware/platformAdmin/authenticatePlatformAdmin');
const requireMfa = require('../../middleware/platformAdmin/requireMfa');
const requireMustChangePassword = require('../../middleware/platformAdmin/requireMustChangePassword');
const requirePlatformPermission = require('../../middleware/platformAdmin/requirePlatformPermission');
const { PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');

const router = express.Router();

// A lightweight per-keystroke-ish endpoint (Ctrl+K search-as-you-type) —
// rate limited a bit more generously than auth routes, but still capped
// so a runaway frontend loop can't hammer seven queries per request
// indefinitely.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 60 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Gated on DASHBOARD_VIEW as the baseline "can use the console at all"
// permission — the actual per-category visibility is enforced inside
// globalSearch itself (see platformSearchService.js), which independently
// checks each category's own permission before running that category's
// query at all.
router.get(
  '/',
  authenticatePlatformAdmin,
  requireMfa,
  requireMustChangePassword,
  requirePlatformPermission(PLATFORM_PERMISSIONS.DASHBOARD_VIEW),
  searchLimiter,
  platformSearchController.search
);

module.exports = router;
