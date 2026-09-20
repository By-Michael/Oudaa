const express = require('express');
const platformDashboardController = require('../../controllers/platformAdmin/platformDashboardController');
const authenticatePlatformAdmin = require('../../middleware/platformAdmin/authenticatePlatformAdmin');
const requireMfa = require('../../middleware/platformAdmin/requireMfa');
const requireMustChangePassword = require('../../middleware/platformAdmin/requireMustChangePassword');
const requirePlatformPermission = require('../../middleware/platformAdmin/requirePlatformPermission');
const { PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');

const router = express.Router();

// Every route below requires the SAME chain as Phase 1's proof-of-concept
// stub: authenticate -> MFA (if mandatory for this role) -> permission ->
// (view routes are read-only, so no per-request audit log entry beyond
// what authentication itself already recorded — logging every dashboard
// poll would flood the audit trail with noise for zero security value).
router.get(
  '/summary',
  authenticatePlatformAdmin,
  requireMfa,
  requireMustChangePassword,
  requirePlatformPermission(PLATFORM_PERMISSIONS.DASHBOARD_VIEW),
  platformDashboardController.summary
);

router.get(
  '/charts/growth',
  authenticatePlatformAdmin,
  requireMfa,
  requireMustChangePassword,
  requirePlatformPermission(PLATFORM_PERMISSIONS.DASHBOARD_VIEW),
  platformDashboardController.growthChart
);

router.get(
  '/charts/financial-activity',
  authenticatePlatformAdmin,
  requireMfa,
  requireMustChangePassword,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PERFORMANCE_VIEW),
  platformDashboardController.financialActivityChart
);

router.get(
  '/alerts',
  authenticatePlatformAdmin,
  requireMfa,
  requireMustChangePassword,
  requirePlatformPermission(PLATFORM_PERMISSIONS.DASHBOARD_VIEW),
  platformDashboardController.alerts
);

router.get(
  '/recent-activity',
  authenticatePlatformAdmin,
  requireMfa,
  requireMustChangePassword,
  requirePlatformPermission(PLATFORM_PERMISSIONS.DASHBOARD_VIEW),
  platformDashboardController.recentActivity
);

module.exports = router;
