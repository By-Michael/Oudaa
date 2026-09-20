'use strict';
const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const service = require('../../services/platformAdmin/platformFeatureFlagService');
const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');

const validatePayload = (body, partial = false) => {
  if (!partial && (!body.key || !body.key.trim())) throw new AppError('Flag key is required', 400);
  if (body.rolloutPercentage !== undefined && (!Number.isInteger(Number(body.rolloutPercentage)) || Number(body.rolloutPercentage) < 0 || Number(body.rolloutPercentage) > 100)) throw new AppError('rolloutPercentage must be an integer from 0 to 100', 400);
  if (body.communityIds !== undefined && !Array.isArray(body.communityIds)) throw new AppError('communityIds must be an array', 400);
};

const list = catchAsync(async (req, res) => res.json({ success: true, data: await service.listFlags({ environment: req.query.environment, search: req.query.search }) }));
const get = catchAsync(async (req, res) => {
  const flag = await service.getFlag(req.params.id);
  if (!flag) throw new AppError('Feature flag not found', 404);
  res.json({ success: true, data: flag });
});
const create = catchAsync(async (req, res) => {
  validatePayload(req.body);
  const flag = await service.createFlag(req.body);
  await recordPlatformAudit(req, { action: 'FEATURE_FLAG_CREATED', entityType: 'PlatformFeatureFlag', entityId: flag.id, description: `Feature flag ${flag.key} created.`, metadata: { key: flag.key, environment: flag.environment, enabled: flag.enabled, rolloutPercentage: flag.rolloutPercentage, communityIds: req.body.communityIds || [] } });
  res.status(201).json({ success: true, data: await service.getFlag(flag.id) });
});
const update = catchAsync(async (req, res) => {
  validatePayload(req.body, true);
  const before = await service.getFlag(req.params.id);
  if (!before) throw new AppError('Feature flag not found', 404);
  const flag = await service.updateFlag(req.params.id, req.body);
  await recordPlatformAudit(req, { action: 'FEATURE_FLAG_UPDATED', entityType: 'PlatformFeatureFlag', entityId: flag.id, description: `Feature flag ${flag.key} updated.`, metadata: { before, after: await service.getFlag(flag.id) } });
  res.json({ success: true, data: await service.getFlag(flag.id) });
});
const remove = catchAsync(async (req, res) => {
  const flag = await service.getFlag(req.params.id);
  if (!flag) throw new AppError('Feature flag not found', 404);
  await service.deleteFlag(req.params.id);
  await recordPlatformAudit(req, { action: 'FEATURE_FLAG_DELETED', entityType: 'PlatformFeatureFlag', entityId: req.params.id, description: `Feature flag ${flag.key} deleted.`, metadata: { flag } });
  res.json({ success: true });
});
const history = catchAsync(async (req, res) => res.json({ success: true, data: await service.history(req.params.id, req.query) }));
const evaluate = catchAsync(async (req, res) => {
  const enabled = await service.evaluateFlag({ key: req.params.key, environment: req.query.environment || 'production', communityId: req.query.communityId, userId: req.query.userId });
  res.json({ success: true, data: { key: req.params.key, environment: req.query.environment || 'production', enabled } });
});
module.exports = { list, get, create, update, remove, history, evaluate };
