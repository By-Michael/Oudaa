'use strict';

const express = require('express');
const controller = require('../../controllers/platformAdmin/platformAuditCenterController');
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
  requirePlatformPermission(PLATFORM_PERMISSIONS.AUDIT_VIEW),
];

// Read-only by design. There are deliberately no write endpoints for audit data.
router.get('/', ...auth, controller.list);
router.get('/:id', ...auth, controller.detail);

module.exports = router;
