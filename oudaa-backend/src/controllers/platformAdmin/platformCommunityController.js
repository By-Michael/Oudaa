'use strict';

const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const communityService = require('../../services/platformAdmin/platformCommunityService');
const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');
const notificationService = require('../../services/platformAdmin/platformNotificationService');

/**
 * GET /platform/v1/communities
 * Server-side paginated community directory.
 */
const list = catchAsync(async (req, res) => {
  const result = await communityService.listCommunities({
    search: req.query.search,
    status: req.query.status,
    activityFilter: req.query.activityFilter,
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
 * GET /platform/v1/communities/:id
 * Full community detail.
 */
const detail = catchAsync(async (req, res) => {
  const community = await communityService.getCommunityDetail(req.params.id);
  if (!community) throw new AppError('Community not found', 404);
  res.json({ success: true, data: community });
});

/**
 * GET /platform/v1/communities/:id/users
 * Paginated users within a specific community.
 */
const communityUsers = catchAsync(async (req, res) => {
  const result = await communityService.getCommunityUsers(req.params.id, {
    role: req.query.role,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, ...result });
});

/**
 * PATCH /platform/v1/communities/:id/status
 * Suspend or reactivate a community.
 */
const setStatus = catchAsync(async (req, res) => {
  const { status, reason } = req.body;
  const allowed = ['ACTIVE', 'SUSPENDED'];
  if (!allowed.includes(status)) {
    throw new AppError(`status must be one of: ${allowed.join(', ')}`, 400);
  }
  if (!reason || !String(reason).trim()) {
    throw new AppError('A reason is required for community status changes', 400);
  }

  // Verify the community exists first
  const existing = await communityService.getCommunityDetail(req.params.id);
  if (!existing) throw new AppError('Community not found', 404);

  if (existing.status === status) {
    throw new AppError(`Community is already ${status}`, 409);
  }

  const updated = await communityService.setCommunityStatus(req.params.id, status, reason);

  await recordPlatformAudit(req, {
    action: status === 'SUSPENDED' ? 'COMMUNITY_SUSPENDED' : 'COMMUNITY_REACTIVATED',
    entityType: 'Community',
    entityId: req.params.id,
    communityId: req.params.id,
    description: `Community "${updated.name}" (${updated.slug}) ${status === 'SUSPENDED' ? 'suspended' : 'reactivated'} by ${req.platformAdmin.email}.${reason ? ` Reason: ${reason}` : ''}`,
    metadata: { previousStatus: existing.status, newStatus: status, reason },
    success: true,
  });

  await notificationService.createNotification({
    type: 'COMMUNITY_OPERATION',
    severity: status === 'SUSPENDED' ? 'WARNING' : 'INFO',
    title: status === 'SUSPENDED' ? 'Community suspended' : 'Community reactivated',
    message: `Community ${updated.name} was ${status === 'SUSPENDED' ? 'suspended' : 'reactivated'}.`,
    route: `/platform-admin/communities/${updated.id}`,
    metadata: { communityId: updated.id, status, reason: String(reason).trim() },
  }).catch(() => {});

  res.json({ success: true, data: updated });
});

const revokeAdminSessions = catchAsync(async (req, res) => {
  const community = await communityService.getCommunityDetail(req.params.id);
  if (!community) throw new AppError('Community not found', 404);
  if (!req.body.reason || !String(req.body.reason).trim()) throw new AppError('A reason is required', 400);
  const result = await communityService.revokeCommunityAdminSessions(req.params.id);
  await recordPlatformAudit(req, {
    action: 'COMMUNITY_ADMIN_SESSIONS_REVOKED',
    entityType: 'Community',
    entityId: req.params.id,
    communityId: req.params.id,
    description: `All community-admin sessions for "${community.name}" were revoked by ${req.platformAdmin.email}. Reason: ${String(req.body.reason).trim()}`,
    metadata: { ...result, reason: String(req.body.reason).trim() },
  });
  res.json({ success: true, data: result });
});

const operationalWarnings = catchAsync(async (req, res) => {
  const community = await communityService.getCommunityDetail(req.params.id);
  if (!community) throw new AppError('Community not found', 404);
  res.json({ success: true, data: await communityService.getOperationalWarnings(req.params.id) });
});

module.exports = { list, detail, communityUsers, setStatus, revokeAdminSessions, operationalWarnings };
