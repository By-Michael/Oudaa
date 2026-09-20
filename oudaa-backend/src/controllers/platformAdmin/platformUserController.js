'use strict';

const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const userService = require('../../services/platformAdmin/platformUserService');
const supportViewService = require('../../services/platformAdmin/platformSupportViewService');
const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');

/**
 * GET /platform/v1/users
 * Platform-wide paginated user search.
 */
const list = catchAsync(async (req, res) => {
  const result = await userService.listUsers({
    search: req.query.search,
    communityId: req.query.communityId,
    role: req.query.role,
    residentStatus: req.query.residentStatus,
    createdAfter: req.query.createdAfter,
    createdBefore: req.query.createdBefore,
    sortBy: req.query.sortBy,
    sortDir: req.query.sortDir,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });

  res.json({ success: true, ...result });
});

/**
 * GET /platform/v1/users/:id
 * Full user detail — secrets masked.
 */
const detail = catchAsync(async (req, res) => {
  const user = await userService.getUserDetail(req.params.id);
  if (!user) throw new AppError('User not found', 404);

  await recordPlatformAudit(req, {
    action: 'USER_VIEWED',
    entityType: 'User',
    entityId: req.params.id,
    communityId: user.communityId ?? undefined,
    description: `Operator ${req.platformAdmin.email} viewed user ${user.email}.`,
    success: true,
  });

  res.json({ success: true, data: user });
});

/**
 * POST /platform/v1/users/:id/revoke-sessions
 * Revoke all active sessions for a user (immediate sign-out).
 * Does NOT delete the user or change their data.
 */
const revokeSessions = catchAsync(async (req, res) => {
  const user = await userService.getUserDetail(req.params.id);
  if (!user) throw new AppError('User not found', 404);

  await userService.revokeUserSessions(req.params.id);

  await recordPlatformAudit(req, {
    action: 'USER_SESSIONS_REVOKED',
    entityType: 'User',
    entityId: req.params.id,
    communityId: user.communityId ?? undefined,
    description: `All sessions for user ${user.email} revoked by operator ${req.platformAdmin.email}.`,
    success: true,
  });

  res.json({ success: true, message: 'All sessions revoked' });
});

/**
 * POST /platform/v1/users/:id/support-view
 * Start a read-only view-as session. Requires IMPERSONATION_USE permission.
 */
const startSupportView = catchAsync(async (req, res) => {
  const session = await supportViewService.startSupportView(req, req.params.id);
  res.status(201).json({ success: true, data: session });
});

/**
 * DELETE /platform/v1/users/support-view/:sessionId
 * End a support view session early.
 */
const endSupportView = catchAsync(async (req, res) => {
  await supportViewService.endSupportView(req, req.params.sessionId);
  res.json({ success: true, message: 'Support view session ended' });
});

/**
 * GET /platform/v1/users/support-view/:sessionId
 * Get the read-only snapshot for an active support view session.
 */
const getSupportViewSnapshot = catchAsync(async (req, res) => {
  const session = await supportViewService.validateSupportView(req.params.sessionId);
  if (!session) throw new AppError('Support view session not found or expired', 404);

  // Only the operator who created the session can use it
  if (session.operatorId !== req.platformAdmin.id) {
    throw new AppError('You do not have access to this support view session', 403);
  }

  const snapshot = await supportViewService.getSupportViewSnapshot(session.targetUserId);
  if (!snapshot) throw new AppError('Target user no longer exists', 404);

  res.json({
    success: true,
    data: {
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
        operatorEmail: session.operatorEmail,
        targetEmail: session.targetEmail,
      },
      user: snapshot,
    },
  });
});

module.exports = {
  list,
  detail,
  revokeSessions,
  startSupportView,
  endSupportView,
  getSupportViewSnapshot,
};
