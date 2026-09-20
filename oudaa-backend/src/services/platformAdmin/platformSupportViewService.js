'use strict';

const prisma = require('../../config/prisma');
const { recordPlatformAudit } = require('./platformAuditService');

// View sessions expire after 30 minutes by default
const VIEW_SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Start a read-only view-as session for a community user.
 * Creates a PlatformSupportView row + audit log entry. Returns
 * the session token (session id) and the safe user snapshot.
 * NEVER returns passwords, hashes, tokens, or MFA secrets.
 */
async function startSupportView(req, targetUserId) {
  const operator = req.platformAdmin;

  // Resolve the target user — safe fields only
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      communityId: true,
      createdAt: true,
      community: { select: { id: true, name: true, slug: true } },
      resident: {
        select: {
          id: true,
          status: true,
          unitNumber: true,
        },
      },
    },
  });

  if (!targetUser) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  // Create the session record
  const expiresAt = new Date(Date.now() + VIEW_SESSION_TTL_MS);
  const session = await prisma.platformSupportView.create({
    data: {
      operatorId: operator.id,
      operatorEmail: operator.email,
      targetUserId: targetUser.id,
      targetEmail: targetUser.email,
      targetCommunityId: targetUser.communityId ?? '',
      expiresAt,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    },
  });

  // Mandatory audit record — this is what makes it traceable
  await recordPlatformAudit(req, {
    action: 'SUPPORT_VIEW_STARTED',
    entityType: 'User',
    entityId: targetUser.id,
    communityId: targetUser.communityId ?? undefined,
    description: `Operator ${operator.email} started a support view session for user ${targetUser.email} (${targetUser.role}) in community ${targetUser.community?.name ?? 'unknown'}.`,
    metadata: {
      sessionId: session.id,
      targetRole: targetUser.role,
      expiresAt: expiresAt.toISOString(),
    },
    success: true,
  });

  return {
    sessionId: session.id,
    expiresAt,
    targetUser: {
      id: targetUser.id,
      fullName: targetUser.fullName,
      email: targetUser.email,
      role: targetUser.role,
      communityId: targetUser.communityId,
      community: targetUser.community,
      resident: targetUser.resident,
    },
  };
}

/**
 * Validate a view-as session and return the operator context.
 * Called on every request that uses the support-view token.
 */
async function validateSupportView(sessionId) {
  const session = await prisma.platformSupportView.findUnique({
    where: { id: sessionId },
  });

  if (!session) return null;
  if (session.revoked) return null;
  if (session.expiresAt < new Date()) return null;

  return session;
}

/**
 * End a support view session early (operator logs out or admin revokes).
 */
async function endSupportView(req, sessionId) {
  const session = await prisma.platformSupportView.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.revoked) return;

  await prisma.platformSupportView.update({
    where: { id: sessionId },
    data: { revoked: true, revokedAt: new Date() },
  });

  await recordPlatformAudit(req, {
    action: 'SUPPORT_VIEW_ENDED',
    entityType: 'User',
    entityId: session.targetUserId,
    communityId: session.targetCommunityId ?? undefined,
    description: `Support view session for ${session.targetEmail} ended by operator ${req.platformAdmin?.email}.`,
    metadata: { sessionId },
    success: true,
  });
}

/**
 * Read-only safe snapshot of a community user for the support view.
 * Called by the view-as endpoint once the session is validated.
 * NEVER returns secrets.
 */
async function getSupportViewSnapshot(targetUserId) {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      communityId: true,
      createdAt: true,
      updatedAt: true,
      avatarUrl: true,
      community: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
        },
      },
      resident: {
        select: {
          id: true,
          status: true,
          unitNumber: true,
          inactiveReason: true,
        },
      },
      // Active sessions (count only — no hashes)
      refreshTokens: {
        where: { revoked: false, expiresAt: { gt: new Date() } },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!user) return null;

  const recentActivity = await prisma.auditLog.findMany({
    where: { actorId: targetUserId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      action: true,
      entityType: true,
      description: true,
      createdAt: true,
    },
  });

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    community: user.community,
    residentProfile: user.resident,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    avatarUrl: user.avatarUrl ?? null,
    lastActivity: user.refreshTokens[0]?.createdAt ?? null,
    recentActivity,
    // Secrets: intentionally absent
  };
}

module.exports = {
  startSupportView,
  validateSupportView,
  endSupportView,
  getSupportViewSnapshot,
};
