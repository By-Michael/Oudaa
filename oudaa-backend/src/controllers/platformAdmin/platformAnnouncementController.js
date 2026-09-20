'use strict';
const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const service = require('../../services/platformAdmin/platformAnnouncementService');
const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');

const list = catchAsync(async (req, res) => res.json({ success: true, data: await service.list(req.query) }));
const get = catchAsync(async (req, res) => {
  const row = await service.get(req.params.id);
  if (!row) throw new AppError('Announcement not found', 404);
  res.json({ success: true, data: row });
});
const create = catchAsync(async (req, res) => {
  if (!req.body.title?.trim() || !req.body.message?.trim()) throw new AppError('Title and message are required', 400);
  if (req.body.targetAll === false && !req.body.communityIds?.length) throw new AppError('Select at least one community or target all communities', 400);
  const row = await service.create(req.body);
  await recordPlatformAudit(req, { action: 'ANNOUNCEMENT_CREATED', entityType: 'PlatformAnnouncement', entityId: row.id, description: `Platform announcement "${row.title}" created.`, metadata: { type: row.type, targetAll: row.targetAll, scheduledFor: row.scheduledFor, expiresAt: row.expiresAt } });
  res.status(201).json({ success: true, data: await service.get(row.id) });
});
const update = catchAsync(async (req, res) => {
  const before = await service.get(req.params.id);
  if (!before) throw new AppError('Announcement not found', 404);
  const row = await service.update(req.params.id, req.body);
  await recordPlatformAudit(req, { action: 'ANNOUNCEMENT_UPDATED', entityType: 'PlatformAnnouncement', entityId: row.id, description: `Platform announcement "${row.title}" updated.`, metadata: { before, after: await service.get(row.id) } });
  res.json({ success: true, data: await service.get(row.id) });
});
const publish = catchAsync(async (req, res) => {
  const row = await service.get(req.params.id); if (!row) throw new AppError('Announcement not found', 404);
  const updated = await service.publish(req.params.id);
  await recordPlatformAudit(req, { action: 'ANNOUNCEMENT_PUBLISHED', entityType: 'PlatformAnnouncement', entityId: row.id, description: `Platform announcement "${row.title}" published.`, metadata: { targetAll: row.targetAll, targets: row.targets } });
  res.json({ success: true, data: updated });
});
const schedule = catchAsync(async (req, res) => {
  if (!req.body.scheduledFor || Number.isNaN(new Date(req.body.scheduledFor).getTime())) throw new AppError('A valid scheduledFor date is required', 400);
  const row = await service.get(req.params.id); if (!row) throw new AppError('Announcement not found', 404);
  const updated = await service.schedule(req.params.id, req.body.scheduledFor);
  await recordPlatformAudit(req, { action: 'ANNOUNCEMENT_SCHEDULED', entityType: 'PlatformAnnouncement', entityId: row.id, description: `Platform announcement "${row.title}" scheduled.`, metadata: { scheduledFor: req.body.scheduledFor } });
  res.json({ success: true, data: updated });
});
const archive = catchAsync(async (req, res) => {
  const row = await service.get(req.params.id); if (!row) throw new AppError('Announcement not found', 404);
  const updated = await service.archive(req.params.id);
  await recordPlatformAudit(req, { action: 'ANNOUNCEMENT_ARCHIVED', entityType: 'PlatformAnnouncement', entityId: row.id, description: `Platform announcement "${row.title}" archived.` });
  res.json({ success: true, data: updated });
});
const activeForCommunity = catchAsync(async (req, res) => res.json({ success: true, data: await service.activeForCommunity(req.user.communityId) }));
module.exports = { list, get, create, update, publish, schedule, archive, activeForCommunity };
