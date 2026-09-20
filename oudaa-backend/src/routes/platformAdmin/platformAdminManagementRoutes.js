'use strict';

const express = require('express');
const controller = require('../../controllers/platformAdmin/platformAdminManagementController');
const authenticatePlatformAdmin = require('../../middleware/platformAdmin/authenticatePlatformAdmin');
const requireMfa = require('../../middleware/platformAdmin/requireMfa');
const requireMustChangePassword = require('../../middleware/platformAdmin/requireMustChangePassword');
const requireRecentReauthentication = require('../../middleware/platformAdmin/requireRecentReauthentication');
const requirePlatformPermission = require('../../middleware/platformAdmin/requirePlatformPermission');
const validate = require('../../middleware/validate');
const { PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');
const {
  createPlatformAdminSchema,
  changeRoleSchema,
  setActiveStatusSchema,
  requirePasswordResetSchema,
  requireMfaReenrollmentSchema,
  revokeAdminSessionsSchema,
} = require('../../validators/platformAdmin/platformAdminManagementValidators');

const router = express.Router();

// Every route here manages the identity/access of OTHER platform
// operators, so the base chain is the same as everywhere else
// (authenticate -> MFA -> forced-reset check) plus, on every mutating
// route, a step-up re-authentication window tighter than the general
// 15-30 min default used elsewhere (see requireRecentReauthentication's
// own doc comment) — these are exactly the "most sensitive actions" it
// calls out.
const authChain = [authenticatePlatformAdmin, requireMfa, requireMustChangePassword];
const REAUTH_MINUTES = 15;

router.get(
  '/',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.ADMINS_VIEW),
  controller.list
);

router.get(
  '/:id',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.ADMINS_VIEW),
  controller.detail
);

router.post(
  '/',
  ...authChain,
  requireRecentReauthentication(REAUTH_MINUTES),
  requirePlatformPermission(PLATFORM_PERMISSIONS.ADMINS_MANAGE),
  validate(createPlatformAdminSchema),
  controller.create
);

router.post(
  '/:id/enable',
  ...authChain,
  requireRecentReauthentication(REAUTH_MINUTES),
  requirePlatformPermission(PLATFORM_PERMISSIONS.ADMINS_MANAGE),
  validate(setActiveStatusSchema),
  controller.enable
);

router.post(
  '/:id/disable',
  ...authChain,
  requireRecentReauthentication(REAUTH_MINUTES),
  requirePlatformPermission(PLATFORM_PERMISSIONS.ADMINS_MANAGE),
  validate(setActiveStatusSchema),
  controller.disable
);

router.patch(
  '/:id/role',
  ...authChain,
  requireRecentReauthentication(REAUTH_MINUTES),
  requirePlatformPermission(PLATFORM_PERMISSIONS.ADMINS_MANAGE),
  validate(changeRoleSchema),
  controller.changeRole
);

router.post(
  '/:id/require-password-reset',
  ...authChain,
  requireRecentReauthentication(REAUTH_MINUTES),
  requirePlatformPermission(PLATFORM_PERMISSIONS.ADMINS_MANAGE),
  validate(requirePasswordResetSchema),
  controller.requirePasswordReset
);

router.post(
  '/:id/require-mfa-reenrollment',
  ...authChain,
  requireRecentReauthentication(REAUTH_MINUTES),
  requirePlatformPermission(PLATFORM_PERMISSIONS.ADMINS_MANAGE),
  validate(requireMfaReenrollmentSchema),
  controller.requireMfaReenrollment
);

router.post(
  '/:id/revoke-sessions',
  ...authChain,
  requireRecentReauthentication(REAUTH_MINUTES),
  requirePlatformPermission(PLATFORM_PERMISSIONS.ADMINS_MANAGE),
  validate(revokeAdminSessionsSchema),
  controller.revokeSessions
);

module.exports = router;
