'use strict';
const catchAsync = require('../../utils/catchAsync');
const service = require('../../services/platformAdmin/platformNotificationService');
const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');
const list = catchAsync(async (req, res) => res.json({ success: true, data: await service.listForAdmin(req.platformAdmin.id, { limit: req.query.limit, unreadOnly: req.query.unreadOnly === 'true' }), unreadCount: await service.unreadCount(req.platformAdmin.id) }));
const markRead = catchAsync(async (req, res) => { await service.markRead(req.platformAdmin.id, req.params.id); await recordPlatformAudit(req, { action: 'PLATFORM_NOTIFICATION_READ', entityType: 'PlatformNotification', entityId: req.params.id, description: `Platform notification ${req.params.id} marked read.` }); res.json({ success: true }); });
const markAllRead = catchAsync(async (req, res) => { const count = await service.markAllRead(req.platformAdmin.id); res.json({ success: true, data: { markedRead: count } }); });
module.exports = { list, markRead, markAllRead };
