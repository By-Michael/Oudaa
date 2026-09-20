'use strict';
const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const service = require('../../services/platformAdmin/platformMaintenanceService');
const notificationService = require('../../services/platformAdmin/platformNotificationService');
const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');

const get = catchAsync(async (req, res) => res.json({ success: true, data: await service.getMaintenance(true) }));
const update = catchAsync(async (req, res) => {
  const enabled = Boolean(req.body.enabled);
  if (!req.body.reason || String(req.body.reason).trim().length < 3) throw new AppError('A reason is required for maintenance changes', 400);
  if (enabled && (!req.body.message || !String(req.body.message).trim())) throw new AppError('Maintenance message is required when enabling maintenance mode', 400);
  if (req.body.expectedDurationMins !== undefined && req.body.expectedDurationMins !== null && (!Number.isInteger(Number(req.body.expectedDurationMins)) || Number(req.body.expectedDurationMins) < 1)) throw new AppError('expectedDurationMins must be a positive integer or null', 400);
  const before = await service.getMaintenance(true);
  const updated = await service.updateMaintenance({ ...req.body, enabled, updatedById: req.platformAdmin.id });
  await recordPlatformAudit(req, { action: enabled ? 'MAINTENANCE_ENABLED' : 'MAINTENANCE_DISABLED', entityType: 'PlatformMaintenance', entityId: 'default', description: `Platform maintenance mode ${enabled ? 'enabled' : 'disabled'} by ${req.platformAdmin.email}.`, metadata: { before: { enabled: before.enabled, message: before.message, expectedDurationMins: before.expectedDurationMins }, after: { enabled: updated.enabled, message: updated.message, expectedDurationMins: updated.expectedDurationMins }, reason: req.body.reason || null } });
  await notificationService.createNotification({ type: 'MAINTENANCE_EVENT', severity: enabled ? 'WARNING' : 'INFO', title: enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled', message: enabled ? updated.message : 'Normal platform traffic has been restored.', route: '/platform-admin/maintenance', metadata: { expectedDurationMins: updated.expectedDurationMins } }).catch(() => {});
  res.json({ success: true, data: updated });
});
module.exports = { get, update };
