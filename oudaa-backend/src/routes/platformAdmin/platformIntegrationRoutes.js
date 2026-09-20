'use strict';

const express = require('express');
const controller = require('../../controllers/platformAdmin/platformIntegrationController');
const authenticatePlatformAdmin = require('../../middleware/platformAdmin/authenticatePlatformAdmin');
const requireMfa = require('../../middleware/platformAdmin/requireMfa');
const requireMustChangePassword = require('../../middleware/platformAdmin/requireMustChangePassword');
const requirePlatformPermission = require('../../middleware/platformAdmin/requirePlatformPermission');
const { PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');

const router = express.Router();
const auth = [
  authenticatePlatformAdmin,
  requireMfa,
  requireMustChangePassword,
  requirePlatformPermission(PLATFORM_PERMISSIONS.SETTINGS_VIEW),
];

router.get('/', ...auth, controller.list);

module.exports = router;
