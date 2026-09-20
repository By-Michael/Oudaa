'use strict';

const express = require('express');
const ticketController = require('../../controllers/platformAdmin/platformSupportTicketController');
const aiController = require('../../controllers/platformAdmin/platformSupportAiController');
const analyticsController = require('../../controllers/platformAdmin/platformSupportAnalyticsController');
const authenticatePlatformAdmin = require('../../middleware/platformAdmin/authenticatePlatformAdmin');
const requireMfa = require('../../middleware/platformAdmin/requireMfa');
const requireMustChangePassword = require('../../middleware/platformAdmin/requireMustChangePassword');
const requirePlatformPermission = require('../../middleware/platformAdmin/requirePlatformPermission');
const auditPlatformAction = require('../../middleware/platformAdmin/auditPlatformAction');
const { PLATFORM_PERMISSIONS } = require('../../config/platformPermissions');

const router = express.Router();

// Same auth chain as every other platform-admin route group (Phase 1).
const authChain = [authenticatePlatformAdmin, requireMfa, requireMustChangePassword];

// --- Tickets ---
// View-level actions require SUPPORT_VIEW; anything that changes ticket
// state requires SUPPORT_MANAGE. SUPPORT_AGENT has both (see
// platformPermissions.js) but critically does NOT have SECURITY_VIEW/
// SECURITY_MANAGE — a support agent's permissions are a genuinely
// separate grant from platform-security management, not a subset that
// happens to overlap.
router.get('/tickets', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_VIEW), ticketController.list);

router.get(
  '/tickets/:id',
  ...authChain,
  requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_VIEW),
  auditPlatformAction({ action: 'TICKET_VIEWED', entityType: 'SupportTicket', entityId: (req) => req.params.id }),
  ticketController.detail
);

router.post('/tickets', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_MANAGE), ticketController.create);
router.post('/tickets/:id/messages', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_MANAGE), ticketController.addMessage);
router.patch('/tickets/:id/messages/:messageId', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_MANAGE), ticketController.editMessage);
router.post('/tickets/:id/assign', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_MANAGE), ticketController.assign);
router.post('/tickets/:id/unassign', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_MANAGE), ticketController.unassign);
router.patch('/tickets/:id/status', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_MANAGE), ticketController.changeStatus);
router.post('/tickets/:id/escalate', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_MANAGE), ticketController.escalate);
router.patch('/tickets/:id/priority', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_MANAGE), ticketController.changePriority);
router.patch('/tickets/:id/category', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_MANAGE), ticketController.changeCategory);

// --- AI support visibility ---
router.get('/ai/config', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_VIEW), aiController.config);
router.get('/ai/metrics', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_VIEW), aiController.metrics);
router.get('/ai/conversations', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_VIEW), aiController.conversations);

// --- Analytics ---
router.get('/analytics/overview', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_VIEW), analyticsController.overview);
router.get('/analytics/volume', ...authChain, requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_VIEW), analyticsController.volumeChart);

module.exports = router;
