const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { recordAudit } = require('../utils/audit');
const { getChangeType } = require('../utils/pendingChanges');
const { sendNotificationEmail } = require('../utils/email');

async function communityNameFor(communityId) {
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { name: true } });
  return community?.name;
}

const EXPIRY_HOURS = 24;

const changeInclude = {
  proposedBy: { select: { id: true, fullName: true, email: true } },
  approvals: { include: { member: { select: { id: true, fullName: true } } } },
};

// Self-healing 24h expiry (see design note: no cron/worker service on this
// Render deployment, so expiry is enforced lazily on read/write instead of
// via a background job). Scoped to a community so it stays cheap.
async function sweepExpired(communityId) {
  const expired = await prisma.pendingChange.findMany({
    where: { communityId, status: 'PENDING', expiresAt: { lt: new Date() } },
  });
  for (const pc of expired) {
    await prisma.pendingChange.update({
      where: { id: pc.id },
      data: { status: 'EXPIRED', resolvedAt: new Date() },
    });
    await recordAudit(
      { user: null, communityId },
      {
        action: 'REJECT',
        entityType: 'PendingChange',
        entityId: pc.id,
        description: `${getChangeType(pc.changeType).label} request auto-rejected after 24 hours with no decision`,
      },
    );
  }
}

// Creates a PendingChange instead of applying directly. Called by other
// controllers (e.g. communityController.updateMyCommunity) rather than
// exposed as its own generic public route — the caller already knows the
// changeType/entityId/proposed fields for its own domain.
async function createPendingChange(req, { changeType, entityId, currentEntity, proposedFields }) {
  if (!req.communityId) {
    // Fails loudly and specifically instead of letting `communityId:
    // undefined` reach Prisma, where it surfaces as an opaque
    // PrismaClientValidationError with no hint that a route forgot the
    // tenantScope middleware (see communityRoutes.js history).
    throw new AppError('Internal error: request is missing tenant scope', 500);
  }

  const def = getChangeType(changeType);
  const diff = def.buildDiff(currentEntity, proposedFields);

  if (Object.keys(diff).length === 0) {
    return { noChange: true };
  }

  const otherMembers = await prisma.user.findMany({
    where: { communityId: req.communityId, role: 'ADMIN', id: { not: req.user.id } },
  });

  if (otherMembers.length === 0) {
    // Sole committee member — nobody to approve it. Apply immediately
    // rather than creating a request that can never be resolved, but
    // still write the same audit trail shape for consistency.
    const applied = await prisma.$transaction((tx) => def.apply(tx, entityId, diff, req.communityId));
    await recordAudit(req, {
      action: 'UPDATE',
      entityType: def.entityType,
      entityId,
      description: `${def.label} updated (sole committee member, no other approvers required): ${describeDiff(diff)}`,
    });
    return { applied: true, entity: applied };
  }

  // Members who have a standing CommitteeAutoApproval enabled for this
  // exact changeType get their approval row filled in as APPROVED right
  // away instead of PENDING — same effect as them clicking approve the
  // instant the request was created, just automatic. Scoped strictly per
  // changeType (see schema.prisma comment on CommitteeAutoApproval): a
  // member who auto-approves PROJECT_BUDGET is not silently opted into
  // auto-approving PROJECT_CANCELLATION too.
  const autoApprovals = await prisma.committeeAutoApproval.findMany({
    where: {
      communityId: req.communityId,
      changeType,
      enabled: true,
      expiresAt: { gt: new Date() },
      userId: { in: otherMembers.map((m) => m.id) },
    },
  });
  // scopedToUserIds: [] means "anyone" (original blanket behavior); a
  // non-empty array means this member only auto-approves proposals from
  // those specific committee members, so it only counts here if the
  // current proposer (req.user.id) is one of them.
  const autoApprovedUserIds = new Set(
    autoApprovals
      .filter((a) => a.scopedToUserIds.length === 0 || a.scopedToUserIds.includes(req.user.id))
      .map((a) => a.userId)
  );

  const pendingChange = await prisma.pendingChange.create({
    data: {
      communityId: req.communityId,
      changeType,
      entityType: def.entityType,
      entityId,
      diff,
      proposedById: req.user.id,
      expiresAt: new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000),
      approvals: {
        create: otherMembers.map((m) => (
          autoApprovedUserIds.has(m.id)
            ? { communityId: req.communityId, committeeUserId: m.id, decision: 'APPROVED', respondedAt: new Date(), autoApproved: true }
            : { communityId: req.communityId, committeeUserId: m.id }
        )),
      },
    },
    include: changeInclude,
  });

  if (autoApprovedUserIds.size > 0) {
    const names = otherMembers.filter((m) => autoApprovedUserIds.has(m.id)).map((m) => m.fullName).join(', ');
    await recordAudit(req, {
      action: 'UPDATE',
      entityType: 'PendingChange',
      entityId: pendingChange.id,
      description: `Auto-approved on behalf of ${names} per their standing auto-approval setting for ${def.label}`,
    });
  }

  await recordAudit(req, {
    action: 'CREATE',
    entityType: 'PendingChange',
    entityId: pendingChange.id,
    description: `Proposed change to ${def.label}, needs approval from ${otherMembers.length} other committee member(s): ${describeDiff(diff)}`,
  });

  // Fire-and-forget: notify only the members who still actually need to
  // vote (excluding anyone this request just auto-approved on behalf of).
  const membersToNotify = otherMembers.filter((m) => !autoApprovedUserIds.has(m.id));
  if (membersToNotify.length > 0) {
    const communityName = await communityNameFor(req.communityId);
    for (const member of membersToNotify) {
      sendNotificationEmail({
        to: member.email,
        fullName: member.fullName,
        subject: `A ${def.label} change needs your approval`,
        message: `${req.user.fullName} proposed a change to ${def.label}: ${describeDiff(diff)}. Please review and respond in the app.`,
        communityName,
      }).catch(() => {});
    }
  }

  // If auto-approvals happened to cover everyone else already, resolve
  // immediately rather than leaving a fully-approved request sitting in
  // PENDING until someone happens to reload the list.
  const stillPending = await prisma.pendingChangeApproval.count({
    where: { pendingChangeId: pendingChange.id, decision: { not: 'APPROVED' } },
  });
  if (stillPending === 0 && otherMembers.length > 0) {
    const [resolved] = await prisma.$transaction(async (tx) => {
      await def.apply(tx, pendingChange.entityId, pendingChange.diff, req.communityId);
      const r = await tx.pendingChange.update({
        where: { id: pendingChange.id },
        data: { status: 'APPROVED', resolvedAt: new Date() },
        include: changeInclude,
      });
      return [r];
    });
    await recordAudit(req, {
      action: 'UPDATE',
      entityType: def.entityType,
      entityId: pendingChange.entityId,
      description: `${def.label} updated — every other committee member had auto-approval on for this change type: ${describeDiff(diff)}`,
    });
    return { applied: true, entity: resolved };
  }

  return { pending: pendingChange };
}

function describeDiff(diff) {
  return Object.entries(diff)
    .map(([field, { from, to }]) => `${field}: "${from ?? '(empty)'}" → "${to ?? '(empty)'}"`)
    .join('; ');
}

// Everything the current committee member needs: requests awaiting their
// vote, and their own outgoing requests (for status/cancel visibility).
const listMyPendingChanges = catchAsync(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.json({ success: true, data: { asApprover: [], asProposer: [] } });
  }

  await sweepExpired(req.communityId);

  const [asApprover, asProposer] = await Promise.all([
    prisma.pendingChange.findMany({
      where: {
        communityId: req.communityId,
        status: 'PENDING',
        proposedById: { not: req.user.id },
        approvals: { some: { committeeUserId: req.user.id, decision: 'PENDING' } },
      },
      include: changeInclude,
    }),
    prisma.pendingChange.findMany({
      where: { communityId: req.communityId, proposedById: req.user.id, status: 'PENDING' },
      include: changeInclude,
    }),
  ]);

  res.json({ success: true, data: { asApprover, asProposer } });
});

const respondToPendingChange = catchAsync(async (req, res) => {
  if (req.user.role !== 'ADMIN') throw new AppError('Only a committee member can vote on this', 403);
  const { decision } = req.body; // 'APPROVED' | 'REJECTED'

  await sweepExpired(req.communityId);

  const pendingChange = await prisma.pendingChange.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
    include: { approvals: true },
  });
  if (!pendingChange) throw new AppError('Pending change not found', 404);
  if (pendingChange.status !== 'PENDING') throw new AppError('This request has already been resolved', 422);
  if (pendingChange.proposedById === req.user.id) throw new AppError('You cannot vote on your own request', 422);

  const approval = pendingChange.approvals.find((a) => a.committeeUserId === req.user.id);
  if (!approval) throw new AppError('You are not eligible to vote on this request', 403);
  if (approval.decision !== 'PENDING') throw new AppError('You already responded to this request', 422);

  await prisma.pendingChangeApproval.update({
    where: { id: approval.id },
    data: { decision, respondedAt: new Date() },
  });

  const def = getChangeType(pendingChange.changeType);

  if (decision === 'REJECTED') {
    const updated = await prisma.pendingChange.update({
      where: { id: pendingChange.id },
      data: { status: 'REJECTED', resolvedAt: new Date() },
      include: changeInclude,
    });
    await recordAudit(req, {
      action: 'REJECT',
      entityType: 'PendingChange',
      entityId: pendingChange.id,
      description: `Rejected proposed change to ${def.label}: ${describeDiff(pendingChange.diff)}`,
    });
    sendNotificationEmail({
      to: updated.proposedBy.email,
      fullName: updated.proposedBy.fullName,
      subject: `Your proposed ${def.label} change was rejected`,
      message: `${req.user.fullName} rejected your proposed change to ${def.label}. The request has been cancelled.`,
      communityName: await communityNameFor(req.communityId),
    }).catch(() => {});
    return res.json({ success: true, data: updated });
  }

  const remaining = await prisma.pendingChangeApproval.count({
    where: { pendingChangeId: pendingChange.id, decision: { not: 'APPROVED' } },
  });

  if (remaining > 0) {
    const updated = await prisma.pendingChange.findUnique({ where: { id: pendingChange.id }, include: changeInclude });
    await recordAudit(req, {
      action: 'UPDATE',
      entityType: 'PendingChange',
      entityId: pendingChange.id,
      description: `Approved proposed change to ${def.label}; still awaiting ${remaining} other committee member(s)`,
    });
    return res.json({ success: true, data: updated });
  }

  // Everyone has approved — apply the real change now, atomically with
  // resolving the request so a crash between the two can't leave a
  // fully-approved request that never actually took effect.
  const [updated] = await prisma.$transaction(async (tx) => {
    await def.apply(tx, pendingChange.entityId, pendingChange.diff, pendingChange.communityId);
    const resolved = await tx.pendingChange.update({
      where: { id: pendingChange.id },
      data: { status: 'APPROVED', resolvedAt: new Date() },
      include: changeInclude,
    });
    return [resolved];
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entityType: def.entityType,
    entityId: pendingChange.entityId,
    description: `${def.label} updated after full committee approval: ${describeDiff(pendingChange.diff)}`,
  });

  sendNotificationEmail({
    to: updated.proposedBy.email,
    fullName: updated.proposedBy.fullName,
    subject: `Your proposed ${def.label} change was approved`,
    message: `Every committee member has approved your proposed change to ${def.label}, and it's now been applied.`,
    communityName: await communityNameFor(req.communityId),
  }).catch(() => {});

  res.json({ success: true, data: updated });
});

const cancelPendingChange = catchAsync(async (req, res) => {
  const pendingChange = await prisma.pendingChange.findFirst({
    where: { id: req.params.id, communityId: req.communityId, proposedById: req.user.id },
  });
  if (!pendingChange) throw new AppError('Pending change not found', 404);
  if (pendingChange.status !== 'PENDING') throw new AppError('This request can no longer be cancelled', 422);

  const updated = await prisma.pendingChange.update({
    where: { id: pendingChange.id },
    data: { status: 'REJECTED', resolvedAt: new Date() },
    include: changeInclude,
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entityType: 'PendingChange',
    entityId: pendingChange.id,
    description: `Withdrew own proposed change to ${getChangeType(pendingChange.changeType).label}`,
  });

  res.json({ success: true, data: updated });
});

module.exports = {
  createPendingChange,
  listMyPendingChanges,
  respondToPendingChange,
  cancelPendingChange,
  sweepExpired,
};
