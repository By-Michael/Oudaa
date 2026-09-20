'use strict';

const express = require('express');
const communityController = require('../../controllers/platformAdmin/platformCommunityController');
const authenticatePlatformAdmin = require('../../middleware/platformAdmin/authenticatePlatformAdmin');
const requireMfa = require('../../middleware/platformAdmin/requireMfa');
const requireMustChangePassword = require('../../middleware/platformAdmin/requireMustChangePassword');
const requirePlatformPermission = require('../../middleware/platformAdmin/requirePlatformPermission');
const requireRecentReauthentication = require('../../middleware/platformAdmin/requireRecentReauthentication');
const auditPlatformAction = require('../../middleware/platformAdmin/auditPlatformAction');
const { PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');

const router = express.Router();

// All community-management routes require the same auth chain
const authChain = [
  authenticatePlatformAdmin,
  requireMfa,
  requireMustChangePassword,
];

/**
 * GET /communities
 * Server-side paginated community directory with aggregates.
 */
router.get(
  '/',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.COMMUNITIES_VIEW),
  communityController.list
);

/**
 * GET /communities/:id
 * Full community detail with diagnostics.
 */
router.get(
  '/:id',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.COMMUNITIES_VIEW),
  auditPlatformAction({
    action: 'COMMUNITY_VIEWED',
    entityType: 'Community',
    entityId: (req) => req.params.id,
    communityId: (req) => req.params.id,
  }),
  communityController.detail
);

/**
 * GET /communities/:id/users
 * Users (admins + residents) within a specific community.
 */
router.get(
  '/:id/users',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.COMMUNITIES_VIEW),
  communityController.communityUsers
);

/**
 * PATCH /communities/:id/status
 * Suspend or reactivate a community. Requires COMMUNITIES_MANAGE.
 */
router.patch(
  '/:id/status',
  ...authChain,
  requireRecentReauthentication(15),
  requirePlatformPermission(PLATFORM_PERMISSIONS.COMMUNITIES_MANAGE),
  communityController.setStatus
);


router.get(
  '/:id/warnings',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.COMMUNITIES_VIEW),
  communityController.operationalWarnings
);

router.post(
  '/:id/revoke-admin-sessions',
  ...authChain,
  requireRecentReauthentication(15),
  requirePlatformPermission(PLATFORM_PERMISSIONS.COMMUNITIES_MANAGE),
  communityController.revokeAdminSessions
);

module.exports = router;
