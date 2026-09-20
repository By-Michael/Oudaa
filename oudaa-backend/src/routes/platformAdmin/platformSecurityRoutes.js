'use strict';

const express = require('express');
const controller = require('../../controllers/platformAdmin/platformSecurityController');
const authenticatePlatformAdmin = require('../../middleware/platformAdmin/authenticatePlatformAdmin');
const requireMfa = require('../../middleware/platformAdmin/requireMfa');
const requireMustChangePassword = require('../../middleware/platformAdmin/requireMustChangePassword');
const requireRecentReauthentication = require('../../middleware/platformAdmin/requireRecentReauthentication');
const requirePlatformPermission = require('../../middleware/platformAdmin/requirePlatformPermission');
const validate = require('../../middleware/validate');
const { PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');
const {
  updateSecuritySettingsSchema,
  revokeSessionSchema,
  listEventsQuerySchema,
} = require('../../validators/platformAdmin/platformSecurityValidators');

const router = express.Router();

const authChain = [authenticatePlatformAdmin, requireMfa, requireMustChangePassword];
const REAUTH_MINUTES = 15;

router.get(
  '/overview',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.SECURITY_VIEW),
  controller.overview
);

router.get(
  '/events',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.SECURITY_VIEW),
  validate(listEventsQuerySchema),
  controller.listEvents
);

router.get(
  '/sessions',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.SECURITY_VIEW),
  controller.listSessions
);

// Revoking someone else's session is high-risk enough to warrant the same
// step-up re-authentication as platform-admin management actions, even
// though the permission required (SECURITY_MANAGE) is distinct from
// ADMINS_MANAGE — a SECURITY_AUDITOR can hold this permission without
// being able to touch admin roles/status at all (see platformPermissions.js).
router.delete(
  '/sessions/:sessionId',
  ...authChain,
  requireRecentReauthentication(REAUTH_MINUTES),
  requirePlatformPermission(PLATFORM_PERMISSIONS.SECURITY_MANAGE),
  validate(revokeSessionSchema),
  controller.revokeSession
);

router.get(
  '/settings',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.SETTINGS_VIEW),
  controller.getSettings
);

router.patch(
  '/settings',
  ...authChain,
  requireRecentReauthentication(REAUTH_MINUTES),
  requirePlatformPermission(PLATFORM_PERMISSIONS.SECURITY_MANAGE),
  validate(updateSecuritySettingsSchema),
  controller.updateSettings
);

module.exports = router;
