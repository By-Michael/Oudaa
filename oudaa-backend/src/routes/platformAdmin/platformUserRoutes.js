'use strict';

const express = require('express');
const userController = require('../../controllers/platformAdmin/platformUserController');
const authenticatePlatformAdmin = require('../../middleware/platformAdmin/authenticatePlatformAdmin');
const requireMfa = require('../../middleware/platformAdmin/requireMfa');
const requireMustChangePassword = require('../../middleware/platformAdmin/requireMustChangePassword');
const requirePlatformPermission = require('../../middleware/platformAdmin/requirePlatformPermission');
const { PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');

const router = express.Router();

const authChain = [
  authenticatePlatformAdmin,
  requireMfa,
  requireMustChangePassword,
];

/**
 * GET /users
 * Global platform-wide paginated user search.
 */
router.get(
  '/',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.USERS_VIEW),
  userController.list
);

/**
 * GET /users/:id
 * Full user detail (secrets masked).
 * NOTE: The support-view routes MUST come before /:id to avoid collision.
 */
router.get(
  '/support-view/:sessionId',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.IMPERSONATION_VIEW),
  userController.getSupportViewSnapshot
);

router.delete(
  '/support-view/:sessionId',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.IMPERSONATION_USE),
  userController.endSupportView
);

router.get(
  '/:id',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.USERS_VIEW),
  userController.detail
);

/**
 * POST /users/:id/revoke-sessions
 * Immediately sign out a user by revoking all refresh tokens.
 */
router.post(
  '/:id/revoke-sessions',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.USERS_MANAGE),
  userController.revokeSessions
);

/**
 * POST /users/:id/support-view
 * Start a read-only view-as session. IMPERSONATION_USE required.
 * Generates an audit log entry. The session expires in 30 minutes.
 */
router.post(
  '/:id/support-view',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.IMPERSONATION_USE),
  userController.startSupportView
);

module.exports = router;
