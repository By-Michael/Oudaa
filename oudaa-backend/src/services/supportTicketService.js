const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { recordAudit } = require('../utils/audit');

// Kept in sync with the platform-admin side's notification helper's shape,
// but called directly (not imported cross-module) since the community app
// and platform-admin app are deliberately kept independent of one another.
async function notifyAdmins({ ticket, user }) {
  try {
    await prisma.platformNotification.create({
      data: {
        type: 'SUPPORT_TICKET',
        severity: ticket.priority === 'URGENT' || ticket.priority === 'HIGH' ? 'WARNING' : 'INFO',
        title: 'New support ticket',
        message: `${user.fullName} opened a ticket: "${ticket.subject}"`,
        route: `/platform-admin/support/tickets/${ticket.id}`,
        metadata: { ticketId: ticket.id, communityId: ticket.communityId || undefined },
      },
    });
  } catch (err) {
    // Best-effort — a resident's ticket must still be created even if the
    // platform notification write fails for some reason.
    // eslint-disable-next-line no-console
    console.error('Failed to notify platform admins of new ticket:', err.message);
  }
}

// A resident asks Oudaa AI for help. If the AI can't resolve it, this is the
// "human escalation" path: it opens a real SupportTicket, optionally linked
// back to the chat session that led to it (originConversationId), and
// carries the chat transcript into the ticket description so an agent has
// context immediately instead of asking the resident to repeat themselves.
async function createTicket(req, { subject, description, category, priority, originConversationId }) {
  const user = req.user;

  // If the resident points at one of their own saved chat sessions, fold
  // its transcript into the ticket description and validate ownership so a
  // resident can't reference (and thereby leak) someone else's session id.
  let finalDescription = description;
  let linkedSessionId = null;

  if (originConversationId) {
    const session = await prisma.supportChatSession.findFirst({
      where: { id: originConversationId, userId: user.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) throw new AppError('Conversation not found', 404);
    linkedSessionId = session.id;

    const transcript = session.messages
      .map((m) => `${m.role === 'user' ? user.fullName : 'Oudaa AI'}: ${m.content}`)
      .join('\n');
    finalDescription = description
      ? `${description}\n\n— Prior AI conversation —\n${transcript}`
      : `— Prior AI conversation —\n${transcript}`;
  }

  const ticket = await prisma.supportTicket.create({
    data: {
      userId: user.id,
      communityId: req.communityId || user.communityId || null,
      subject,
      description: finalDescription,
      category: category || 'OTHER',
      priority: priority || 'NORMAL',
      originConversationId: linkedSessionId,
    },
  });

  await recordAudit(req, {
    action: 'CREATE',
    entityType: 'SupportTicket',
    entityId: ticket.id,
    description: `${user.fullName} opened a support ticket: "${subject}"`,
  });

  await notifyAdmins({ ticket, user });

  return ticket;
}

// A resident's own tickets — list view (no message bodies, for a fast list).
async function listMyTickets(req) {
  const tickets = await prisma.supportTicket.findMany({
    where: { userId: req.user.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      subject: true,
      status: true,
      priority: true,
      category: true,
      createdAt: true,
      updatedAt: true,
      lastResponseAt: true,
      _count: { select: { messages: true } },
    },
  });
  return tickets.map((t) => ({ ...t, messageCount: t._count.messages, _count: undefined }));
}

// One of the resident's own tickets, with the full message thread. Internal
// notes (isInternalNote: true) are agent-only and are stripped out here —
// a resident must never see staff-only notes about their own case.
async function getMyTicket(req, ticketId) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, userId: req.user.id },
    include: {
      messages: {
        where: { isInternalNote: false },
        orderBy: { createdAt: 'asc' },
        include: {
          authorUser: { select: { id: true, fullName: true } },
          // Selected but deliberately minimal — a resident sees "Support
          // team" style attribution, not individual admin identities.
          authorPlatformAdmin: { select: { id: true, fullName: true } },
        },
      },
    },
  });
  if (!ticket) throw new AppError('Ticket not found', 404);
  return ticket;
}

// A resident replies on their own open ticket.
async function replyToTicket(req, ticketId, { body }) {
  const ticket = await prisma.supportTicket.findFirst({ where: { id: ticketId, userId: req.user.id } });
  if (!ticket) throw new AppError('Ticket not found', 404);
  if (ticket.status === 'CLOSED') {
    throw new AppError('This ticket is closed. Please open a new one if you need further help.', 400);
  }

  const [message] = await prisma.$transaction([
    prisma.supportTicketMessage.create({
      data: { ticketId, authorUserId: req.user.id, body },
    }),
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        lastResponseAt: new Date(),
        // A reply from the resident on a ticket an agent was waiting on
        // them for should surface back into the active queue.
        status: ticket.status === 'WAITING_FOR_USER' ? 'OPEN' : ticket.status,
      },
    }),
  ]);

  await recordAudit(req, {
    action: 'UPDATE',
    entityType: 'SupportTicket',
    entityId: ticketId,
    description: `${req.user.fullName} replied to their support ticket`,
  });

  return message;
}

module.exports = { createTicket, listMyTickets, getMyTicket, replyToTicket };
