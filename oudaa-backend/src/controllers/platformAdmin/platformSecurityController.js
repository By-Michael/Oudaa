'use strict';

const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const securityService = require('../../services/platformAdmin/platformSecurityService');
const settingsService = require('../../services/platformAdmin/platformSecuritySettingsService');
const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');
const { PLATFORM_AUDIT_ACTIONS } = require('../../config/platformSecurityEvents');
const { createNotification } = require('../../services/platformAdmin/platformNotificationService');

const overview = catchAsync(async (req, res) => {
  const windowHours = req.query.windowHours ? Number(req.query.windowHours) : 24;
  const data = await securityService.getDashboardOverview({ windowHours });
  res.json({ success: true, data });
});

const listEvents = catchAsync(async (req, res) => {
  const categories = req.query.category
    ? Array.isArray(req.query.category) ? req.query.category : [req.query.category]
    : undefined;
  const result = await securityService.listSecurityEvents({
    categories,
    from: req.query.from,
    to: req.query.to,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, ...result });
});

const listSessions = catchAsync(async (req, res) => {
  const result = await securityService.listSessions({
    adminId: req.query.adminId,
    status: req.query.status,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, ...result });
});

const revokeSession = catchAsync(async (req, res) => {
  const session = await securityService.revokeSessionById(req.params.sessionId);
  if (!session) throw new AppError('Session not found', 404);

  await recordPlatformAudit(req, {
    action: PLATFORM_AUDIT_ACTIONS.ADMIN_SESSION_REVOKED,
    entityType: 'PlatformAdminSession',
    entityId: session.id,
    description: `${req.platformAdmin.email} revoked session ${session.id} (admin ${session.platformAdminId})${req.body.reason ? ` — ${req.body.reason}` : ''}`,
    metadata: { targetAdminId: session.platformAdminId, reason: req.body.reason || null },
  });

  await createNotification({
    type: 'SECURITY_EVENT',
    severity: 'WARNING',
    title: 'Platform admin session revoked',
    message: `${req.platformAdmin.email} revoked a platform administrator session.`,
    route: '/platform-admin/security',
    metadata: { sessionId: session.id, targetAdminId: session.platformAdminId },
  });

  res.json({ success: true, message: 'Session revoked' });
});

const getSettings = catchAsync(async (req, res) => {
  const settings = await settingsService.getSecuritySettings({ bypassCache: true });
  res.json({ success: true, data: settings });
});

const updateSettings = catchAsync(async (req, res) => {
  const { reason, confirm, ...patch } = req.body;
  const before = await settingsService.getSecuritySettings({ bypassCache: true });
  const updated = await settingsService.updateSecuritySettings(patch, req.platformAdmin.id);

  await recordPlatformAudit(req, {
    action: PLATFORM_AUDIT_ACTIONS.SECURITY_SETTINGS_UPDATED,
    entityType: 'PlatformSecuritySettings',
    entityId: updated.id,
    description: `${req.platformAdmin.email} updated platform security settings — ${reason}`,
    metadata: { before: { ...before, id: undefined }, changes: patch, reason },
  });

  await createNotification({
    type: 'SECURITY_EVENT',
    severity: 'WARNING',
    title: 'Platform security settings changed',
    message: `${req.platformAdmin.email} changed platform security settings.`,
    route: '/platform-admin/security',
    metadata: { reason, changedKeys: Object.keys(patch) },
  });

  res.json({ success: true, data: updated });
});

module.exports = {
  overview,
  listEvents,
  listSessions,
  revokeSession,
  getSettings,
  updateSettings,
};
