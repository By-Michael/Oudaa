'use strict';

const express = require('express');
const ctrl = require('../../controllers/platformAdmin/platformPerformanceController');
const authenticatePlatformAdmin = require('../../middleware/platformAdmin/authenticatePlatformAdmin');
const requireMfa = require('../../middleware/platformAdmin/requireMfa');
const requireMustChangePassword = require('../../middleware/platformAdmin/requireMustChangePassword');
const requirePlatformPermission = require('../../middleware/platformAdmin/requirePlatformPermission');
const { PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');

const router = express.Router();

// All /performance routes require:
//  1. A valid platform-admin access token.
//  2. MFA (if the role mandates it — enforced by requireMfa).
//  3. The PERFORMANCE_VIEW permission.
//
// The error center (/performance/errors*) shows operational error detail —
// request IDs, endpoints, community/user IDs — which could be sensitive
// in the wrong hands. We therefore require the same PERFORMANCE_VIEW
// permission (PLATFORM_ADMIN, OPERATIONS, SUPER_ADMIN, FINANCE_OPERATOR)
// and deliberately exclude SUPPORT_AGENT, who should use the Support
// Portal (Phase 4) instead.
//
// No route here allows arbitrary query execution or exposes secrets.

const auth = [
  authenticatePlatformAdmin,
  requireMfa,
  requireMustChangePassword,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PERFORMANCE_VIEW),
];

// Overview / health
router.get('/overview',     ...auth, ctrl.overview);
router.get('/process',      ...auth, ctrl.process);

// API diagnostics
router.get('/api',          ...auth, ctrl.apiStats);
router.get('/api/series',   ...auth, ctrl.apiSeries);
router.get('/api/endpoints',...auth, ctrl.apiEndpoints);
router.get('/api/windows',  ...auth, ctrl.apiWindows);

// Infrastructure sections
router.get('/database',     ...auth, ctrl.database);
router.get('/storage',      ...auth, ctrl.storage);
router.get('/integrations', ...auth, ctrl.integrations);

// Error center
router.get('/errors',          ...auth, ctrl.errors);
router.get('/errors/groups',   ...auth, ctrl.errorGroups);
router.get('/errors/summary',  ...auth, ctrl.errorSummary);

// Historical snapshots (for charts / trend analysis)
router.get('/snapshots',    ...auth, ctrl.snapshots);

module.exports = router;
