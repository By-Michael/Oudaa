'use strict';
const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const service = require('../../services/platformAdmin/platformConfigService');
const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');

const list = catchAsync(async (req, res) => res.json({ success: true, data: await service.list({ category: req.query.category }) }));
const update = catchAsync(async (req, res) => {
  if (req.body.value === undefined) throw new AppError('value is required', 400);
  const rows = await service.list({});
  const target = rows.find((r) => r.id === req.params.id);
  if (!target) throw new AppError('Configuration setting not found', 404);
  if (target.managedBy !== 'DATABASE') throw new AppError('This setting is managed by the deployment environment', 409);
  const row = await service.update(req.params.id, req.body.value, req.platformAdmin.id);
  await recordPlatformAudit(req, { action: 'PLATFORM_CONFIG_UPDATED', entityType: 'PlatformConfigSetting', entityId: row.id, description: `Platform configuration ${row.category}.${row.key} updated.`, metadata: { category: row.category, key: row.key, isSensitive: row.isSensitive } });
  res.json({ success: true, data: { ...row, valueJson: row.isSensitive ? null : row.valueJson } });
});
module.exports = { list, update };
