/**
 * Backend for the Platform Support Portal (Phase 4). A SupportTicket is a
 * genuinely new object — see prisma/schema.prisma's comment on why this
 * is deliberately separate from SupportChatSession (the resident/admin's
 * own saved AI conversations, untouched by this file).
 *
 * SECURITY: every function here is only ever called from
 * src/routes/platformAdmin/platformSupportTicketRoutes.js, which requires
 * authenticatePlatformAdmin on every route. There is no community-facing
 * caller anywhere, which is what actually keeps isInternalNote messages
 * out of reach of community users — not a filter this file has to
 * remember to apply for some other caller that doesn't exist.
 */
const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { recordPlatformAudit } = require('./platformAuditService');
const { createNotification } = require('./platformNotificationService');

const SORTABLE_FIELDS = new Set(['createdAt', 'updatedAt', 'lastResponseAt', 'priority', 'status']);

// Inbox "sections" (Phase 4) map to a where-clause shape layered on top of
// whatever explicit filters the request also passed — a section is just a
// named, common filter combination, not a separate query path.
function sectionWhere(section, platformAdminId) {
  switch (section) {
    case 'open':
      return { status: { in: ['OPEN', 'IN_PROGRESS'] } };
    case 'assigned_to_me':
      return { assignedToId: platformAdminId };
    case 'unassigned':
      return { assignedToId: null };
    case 'high_priority':
      return { priority: 'HIGH' };
    case 'urgent':
      return { priority: 'URGENT' };
    case 'waiting_for_user':
      return { status: 'WAITING_FOR_USER' };
    case 'escalated':
      return { status: 'ESCALATED' };
    case 'resolved':
      return { status: 'RESOLVED' };
    case 'closed':
      return { status: 'CLOSED' };
    case 'all':
    case undefined:
    case null:
      return {};
    default:
      throw new AppError(`Unknown support inbox section: ${section}`, 400);
  }
}

async function listTickets(req, { section, page = 1, pageSize, search, communityId, userId, category, status, priority, assignedToId, sortBy = 'createdAt', sortDir = 'desc' }) {
  const where = { ...sectionWhere(section, req.platformAdmin.id) };

  if (search) {
    where.OR = [
      { subject: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { user: { fullName: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
    ];
  }
  if (communityId) where.communityId = communityId;
  if (userId) where.userId = userId;
  if (category) where.category = category;
  if (status) where.status = status; // explicit status filter composes with (and narrows) a section's own status filter
  if (priority) where.priority = priority;
  if (assignedToId) where.assignedToId = assignedToId;

  const orderBy = { [SORTABLE_FIELDS.has(sortBy) ? sortBy : 'createdAt']: sortDir === 'asc' ? 'asc' : 'desc' };
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);

  const [total, tickets] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({
      where,
      orderBy,
      skip: (pageNum - 1) * size,
      take: size,
      select: {
        id: true,
        subject: true,
        status: true,
        priority: true,
        category: true,
        createdAt: true,
        updatedAt: true,
        lastResponseAt: true,
        user: { select: { id: true, fullName: true, email: true } },
        community: { select: { id: true, name: true, slug: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
      },
    }),
  ]);

  return { data: tickets, pagination: { page: pageNum, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) } };
}

/**
 * Full ticket detail — conversation, and enough related-account context
 * (Part "SUPPORT CONTEXT") to answer the ticket without hopping to
 * another screen: the community, the community's admins, any recent
 * payments for this user, and the user's other recent audit history.
 * `includeInternalNotes` defaults true here because every caller of this
 * service IS a platform operator (see the file-level security note) —
 * the parameter exists for defense-in-depth/testability, not because a
 * real caller currently passes false.
 */
async function getTicketDetail(ticketId, { includeInternalNotes = true } = {}) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      user: { select: { id: true, fullName: true, email: true, role: true, communityId: true, createdAt: true } },
      community: { select: { id: true, name: true, slug: true, status: true } },
      assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
      messages: {
        where: includeInternalNotes ? {} : { isInternalNote: false },
        orderBy: { createdAt: 'asc' },
        include: {
          authorUser: { select: { id: true, fullName: true, role: true } },
          authorPlatformAdmin: { select: { id: true, fullName: true, role: true } },
        },
      },
    },
  });
  if (!ticket) return null;

  const [communityAdmins, recentPayments, recentAudit] = await Promise.all([
    ticket.communityId
      ? prisma.user.findMany({ where: { communityId: ticket.communityId, role: 'ADMIN' }, select: { id: true, fullName: true, email: true } })
      : [],
    prisma.payment.findMany({
      where: { resident: { userId: ticket.userId } },
      orderBy: { paidAt: 'desc' },
      take: 5,
      select: { id: true, amount: true, status: true, paidAt: true },
    }),
    prisma.auditLog.findMany({ where: { actorId: ticket.userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);

  // Platform-wide audit history specifically about THIS ticket (status/
  // priority/category/assignment changes) — reuses PlatformAuditLog
  // rather than a separate per-ticket event table, per Part F.
  const ticketAudit = await prisma.platformAuditLog.findMany({
    where: { entityType: 'SupportTicket', entityId: ticketId },
    orderBy: { createdAt: 'desc' },
  });

  return {
    ...ticket,
    context: {
      communityAdmins,
      recentPayments,
      recentAudit,
    },
    ticketAudit,
  };
}

async function createTicket(req, { userId, communityId, subject, description, category, priority, originConversationId }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  const ticket = await prisma.supportTicket.create({
    data: {
      userId,
      communityId: communityId || user.communityId || null,
      subject,
      description,
      category: category || 'OTHER',
      priority: priority || 'NORMAL',
      originConversationId: originConversationId || null,
    },
  });

  await recordPlatformAudit(req, {
    action: 'TICKET_CREATED',
    entityType: 'SupportTicket',
    entityId: ticket.id,
    communityId: ticket.communityId,
    description: `${req.platformAdmin.email} opened a ticket for ${user.email}: "${subject}"`,
  });

  return ticket;
}

async function addMessage(req, ticketId, { body, isInternalNote }) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError('Ticket not found', 404);

  const [message] = await prisma.$transaction([
    prisma.supportTicketMessage.create({
      data: { ticketId, authorPlatformAdminId: req.platformAdmin.id, isInternalNote: !!isInternalNote, body },
    }),
    prisma.supportTicket.update({ where: { id: ticketId }, data: { lastResponseAt: new Date() } }),
  ]);

  await recordPlatformAudit(req, {
    action: isInternalNote ? 'TICKET_NOTE_ADDED' : 'TICKET_REPLY_SENT',
    entityType: 'SupportTicket',
    entityId: ticketId,
    communityId: ticket.communityId,
    description: `${req.platformAdmin.email} ${isInternalNote ? 'added an internal note to' : 'replied to'} ticket ${ticketId}`,
  });

  return message;
}

async function editMessage(req, ticketId, messageId, { body }) {
  const message = await prisma.supportTicketMessage.findUnique({ where: { id: messageId } });
  if (!message || message.ticketId !== ticketId) throw new AppError('Message not found', 404);
  if (message.authorPlatformAdminId !== req.platformAdmin.id) {
    throw new AppError('You can only edit your own messages', 403);
  }

  const updated = await prisma.supportTicketMessage.update({
    where: { id: messageId },
    data: { body, editedAt: new Date() },
  });

  await recordPlatformAudit(req, {
    action: 'TICKET_NOTE_EDITED',
    entityType: 'SupportTicket',
    entityId: ticketId,
    description: `${req.platformAdmin.email} edited a message on ticket ${ticketId}`,
  });

  return updated;
}

// Generic "change one field, audit it with the before/after value" helper
// used by assign/reassign/status/priority/category/escalate below — all
// of them are the same shape of operation on the same model.
async function updateTicketField(req, ticketId, field, value, { action, describe, extraData } = {}) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError('Ticket not found', 404);

  const fromValue = ticket[field];
  const updated = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { [field]: value, ...(extraData || {}) },
  });

  await recordPlatformAudit(req, {
    action,
    entityType: 'SupportTicket',
    entityId: ticketId,
    communityId: ticket.communityId,
    description: describe ? describe(fromValue, value) : `${req.platformAdmin.email} changed ${field} from ${fromValue} to ${value}`,
    metadata: { field, from: fromValue, to: value },
  });

  return updated;
}

async function assignTicket(req, ticketId, assigneeId) {
  const assignee = await prisma.platformAdmin.findUnique({ where: { id: assigneeId } });
  if (!assignee) throw new AppError('Platform admin not found', 404);
  return updateTicketField(req, ticketId, 'assignedToId', assigneeId, {
    action: 'TICKET_ASSIGNED',
    describe: (from) => `${req.platformAdmin.email} ${from ? 'reassigned' : 'assigned'} ticket ${ticketId} to ${assignee.email}`,
  });
}

async function unassignTicket(req, ticketId) {
  return updateTicketField(req, ticketId, 'assignedToId', null, {
    action: 'TICKET_UNASSIGNED',
    describe: () => `${req.platformAdmin.email} unassigned ticket ${ticketId}`,
  });
}

async function changeStatus(req, ticketId, status) {
  const extraData = {};
  if (status === 'RESOLVED') extraData.resolvedAt = new Date();
  if (status === 'CLOSED') extraData.closedAt = new Date();
  return updateTicketField(req, ticketId, 'status', status, {
    action: 'TICKET_STATUS_CHANGED',
    describe: (from, to) => `${req.platformAdmin.email} changed ticket ${ticketId} status from ${from} to ${to}`,
    extraData,
  });
}

async function escalateTicket(req, ticketId) {
  const updated = await updateTicketField(req, ticketId, 'status', 'ESCALATED', {
    action: 'TICKET_ESCALATED',
    describe: () => `${req.platformAdmin.email} escalated ticket ${ticketId}`,
  });

  await createNotification({
    type: 'SUPPORT_ESCALATION',
    severity: updated.priority === 'URGENT' ? 'CRITICAL' : updated.priority === 'HIGH' ? 'ERROR' : 'WARNING',
    title: 'Support ticket escalated',
    message: `${updated.subject} requires platform attention.`,
    route: `/platform-admin/support?ticket=${updated.id}`,
    metadata: { ticketId: updated.id, communityId: updated.communityId, priority: updated.priority },
  }).catch(() => {});
  return updated;
}

async function changePriority(req, ticketId, priority) {
  return updateTicketField(req, ticketId, 'priority', priority, {
    action: 'TICKET_PRIORITY_CHANGED',
    describe: (from, to) => `${req.platformAdmin.email} changed ticket ${ticketId} priority from ${from} to ${to}`,
  });
}

async function changeCategory(req, ticketId, category) {
  return updateTicketField(req, ticketId, 'category', category, {
    action: 'TICKET_CATEGORY_CHANGED',
    describe: (from, to) => `${req.platformAdmin.email} changed ticket ${ticketId} category from ${from} to ${to}`,
  });
}

module.exports = {
  listTickets,
  getTicketDetail,
  createTicket,
  addMessage,
  editMessage,
  assignTicket,
  unassignTicket,
  changeStatus,
  escalateTicket,
  changePriority,
  changeCategory,
};
