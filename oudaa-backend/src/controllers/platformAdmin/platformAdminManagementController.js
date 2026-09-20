'use strict';

const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const adminService = require('../../services/platformAdmin/platformAdminManagementService');
const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');
const { PLATFORM_AUDIT_ACTIONS } = require('../../config/platformSecurityEvents');

const list = catchAsync(async (req, res) => {
  const result = await adminService.listAdmins({
    search: req.query.search,
    role: req.query.role,
    status: req.query.status,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, ...result });
});

const detail = catchAsync(async (req, res) => {
  const admin = await adminService.getAdminDetail(req.params.id);
  if (!admin) throw new AppError('Platform admin not found', 404);

  await recordPlatformAudit(req, {
    action: PLATFORM_AUDIT_ACTIONS.ADMIN_ACTIVITY_VIEWED,
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    description: `${req.platformAdmin.email} viewed operator profile for ${admin.email}`,
  });

  res.json({ success: true, data: admin });
});

const create = catchAsync(async (req, res) => {
  const admin = await adminService.createAdmin(req.body, req.platformAdmin);

  await recordPlatformAudit(req, {
    action: PLATFORM_AUDIT_ACTIONS.ADMIN_CREATED,
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    description: `${req.platformAdmin.email} created platform admin ${admin.email} with role ${admin.role}`,
    metadata: { role: admin.role },
  });

  res.status(201).json({ success: true, data: admin });
});

const enable = catchAsync(async (req, res) => {
  const admin = await adminService.setActiveStatus(req.params.id, true, req.platformAdmin);

  await recordPlatformAudit(req, {
    action: PLATFORM_AUDIT_ACTIONS.ADMIN_ENABLED,
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    description: `${req.platformAdmin.email} re-enabled platform admin ${admin.email}${req.body.reason ? ` — ${req.body.reason}` : ''}`,
    metadata: { reason: req.body.reason || null },
  });

  res.json({ success: true, data: admin });
});

const disable = catchAsync(async (req, res) => {
  const admin = await adminService.setActiveStatus(req.params.id, false, req.platformAdmin);

  await recordPlatformAudit(req, {
    action: PLATFORM_AUDIT_ACTIONS.ADMIN_DISABLED,
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    description: `${req.platformAdmin.email} disabled platform admin ${admin.email} — ${req.body.reason}`,
    metadata: { reason: req.body.reason },
  });

  res.json({ success: true, data: admin });
});

const changeRole = catchAsync(async (req, res) => {
  try {
    const { previousRole, admin } = await adminService.changeRole(req.params.id, req.body.role, req.platformAdmin);

    await recordPlatformAudit(req, {
      action: PLATFORM_AUDIT_ACTIONS.ADMIN_ROLE_CHANGED,
      entityType: 'PlatformAdmin',
      entityId: admin.id,
      description: `${req.platformAdmin.email} changed ${admin.email}'s role from ${previousRole} to ${admin.role} — ${req.body.reason}`,
      metadata: { previousRole, newRole: admin.role, reason: req.body.reason },
    });

    res.json({ success: true, data: admin });
  } catch (err) {
    if (err.details?.code === 'SELF_ESCALATION_BLOCKED') {
      // Denied privilege-escalation attempts are themselves a security
      // event worth keeping — recorded as a FAILED privileged operation
      // (success: false) even though nothing in the DB actually changed.
      await recordPlatformAudit(req, {
        action: PLATFORM_AUDIT_ACTIONS.ADMIN_ROLE_CHANGE_DENIED,
        entityType: 'PlatformAdmin',
        entityId: req.params.id,
        description: `${req.platformAdmin.email} was denied changing ${req.params.id}'s role to ${req.body.role} — self-escalation guard`,
        metadata: { attemptedRole: req.body.role },
        success: false,
      });
    }
    throw err;
  }
});

const requirePasswordReset = catchAsync(async (req, res) => {
  const admin = await adminService.requirePasswordReset(req.params.id, req.platformAdmin);

  await recordPlatformAudit(req, {
    action: PLATFORM_AUDIT_ACTIONS.ADMIN_PASSWORD_RESET_REQUIRED,
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    description: `${req.platformAdmin.email} required a password reset for ${admin.email}${req.body.reason ? ` — ${req.body.reason}` : ''}. All active sessions revoked.`,
    metadata: { reason: req.body.reason || null },
  });

  res.json({ success: true, data: admin, message: 'Password reset required. All active sessions for this admin have been revoked.' });
});

const requireMfaReenrollment = catchAsync(async (req, res) => {
  const admin = await adminService.requireMfaReenrollment(req.params.id, req.platformAdmin);

  await recordPlatformAudit(req, {
    action: PLATFORM_AUDIT_ACTIONS.ADMIN_MFA_REENROLLMENT_REQUIRED,
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    description: `${req.platformAdmin.email} required MFA re-enrollment for ${admin.email}${req.body.reason ? ` — ${req.body.reason}` : ''}. Existing MFA secret revoked.`,
    metadata: { reason: req.body.reason || null },
  });

  res.json({ success: true, data: admin, message: 'MFA re-enrollment required. The previous authenticator secret and recovery codes have been revoked.' });
});

const revokeSessions = catchAsync(async (req, res) => {
  const admin = await adminService.getAdminDetail(req.params.id);
  if (!admin) throw new AppError('Platform admin not found', 404);
  const { revokedCount } = await adminService.revokeAdminSessions(req.params.id);

  await recordPlatformAudit(req, {
    action: PLATFORM_AUDIT_ACTIONS.ADMIN_SESSIONS_REVOKED,
    entityType: 'PlatformAdmin',
    entityId: req.params.id,
    description: `${req.platformAdmin.email} revoked ${revokedCount} session(s) for ${admin.email}${req.body.reason ? ` — ${req.body.reason}` : ''}`,
    metadata: { revokedCount, reason: req.body.reason || null },
  });

  res.json({ success: true, message: `${revokedCount} session(s) revoked` });
});

module.exports = {
  list,
  detail,
  create,
  enable,
  disable,
  changeRole,
  requirePasswordReset,
  requireMfaReenrollment,
  revokeSessions,
};
