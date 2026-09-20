'use strict';

const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const ticketService = require('../../services/platformAdmin/platformSupportTicketService');

const VALID_SECTIONS = new Set([
  'all', 'open', 'assigned_to_me', 'unassigned', 'high_priority', 'urgent',
  'waiting_for_user', 'escalated', 'resolved', 'closed',
]);
const VALID_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'ESCALATED', 'RESOLVED', 'CLOSED']);
const VALID_PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const VALID_CATEGORIES = new Set(['ACCOUNT', 'PAYMENT', 'COMMUNITY', 'TECHNICAL', 'SECURITY', 'FINANCIAL', 'BUG', 'FEATURE_REQUEST', 'OTHER']);

/**
 * GET /platform/v1/support/tickets
 * Paginated, filterable, sectioned ticket inbox.
 */
const list = catchAsync(async (req, res) => {
  const { section } = req.query;
  if (section && !VALID_SECTIONS.has(section)) {
    throw new AppError(`section must be one of: ${[...VALID_SECTIONS].join(', ')}`, 400);
  }

  const result = await ticketService.listTickets(req, {
    section,
    search: req.query.search,
    communityId: req.query.communityId,
    userId: req.query.userId,
    category: req.query.category,
    status: req.query.status,
    priority: req.query.priority,
    assignedToId: req.query.assignedToId,
    sortBy: req.query.sortBy,
    sortDir: req.query.sortDir,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });

  res.json({ success: true, ...result });
});

/**
 * GET /platform/v1/support/tickets/:id
 * Full ticket detail — conversation, internal notes, and related-account
 * context (community, admins, recent payments, recent audit).
 */
const detail = catchAsync(async (req, res) => {
  const ticket = await ticketService.getTicketDetail(req.params.id);
  if (!ticket) throw new AppError('Ticket not found', 404);
  res.json({ success: true, data: ticket });
});

/**
 * POST /platform/v1/support/tickets
 * Opens a new ticket for a user, optionally linked to an existing AI
 * conversation (originConversationId) as a human escalation.
 */
const create = catchAsync(async (req, res) => {
  const { userId, communityId, subject, description, category, priority, originConversationId } = req.body;
  if (!userId || !subject || !description) {
    throw new AppError('userId, subject, and description are required', 400);
  }
  if (category && !VALID_CATEGORIES.has(category)) throw new AppError('Invalid category', 400);
  if (priority && !VALID_PRIORITIES.has(priority)) throw new AppError('Invalid priority', 400);

  const ticket = await ticketService.createTicket(req, { userId, communityId, subject, description, category, priority, originConversationId });
  res.status(201).json({ success: true, data: ticket });
});

/**
 * POST /platform/v1/support/tickets/:id/messages
 * Adds either a customer-visible reply or an internal-only note —
 * isInternalNote in the body decides which, and the two are always
 * rendered distinctly by the frontend (never ambiguous which is which).
 */
const addMessage = catchAsync(async (req, res) => {
  const { body, isInternalNote } = req.body;
  if (!body || !body.trim()) throw new AppError('Message body is required', 400);

  const message = await ticketService.addMessage(req, req.params.id, { body, isInternalNote: !!isInternalNote });
  res.status(201).json({ success: true, data: message });
});

const editMessage = catchAsync(async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) throw new AppError('Message body is required', 400);
  const message = await ticketService.editMessage(req, req.params.id, req.params.messageId, { body });
  res.json({ success: true, data: message });
});

const assign = catchAsync(async (req, res) => {
  const { assigneeId } = req.body;
  if (!assigneeId) throw new AppError('assigneeId is required', 400);
  const ticket = await ticketService.assignTicket(req, req.params.id, assigneeId);
  res.json({ success: true, data: ticket });
});

const unassign = catchAsync(async (req, res) => {
  const ticket = await ticketService.unassignTicket(req, req.params.id);
  res.json({ success: true, data: ticket });
});

const changeStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.has(status)) throw new AppError(`status must be one of: ${[...VALID_STATUSES].join(', ')}`, 400);
  const ticket = await ticketService.changeStatus(req, req.params.id, status);
  res.json({ success: true, data: ticket });
});

const escalate = catchAsync(async (req, res) => {
  const ticket = await ticketService.escalateTicket(req, req.params.id);
  res.json({ success: true, data: ticket });
});

const changePriority = catchAsync(async (req, res) => {
  const { priority } = req.body;
  if (!VALID_PRIORITIES.has(priority)) throw new AppError(`priority must be one of: ${[...VALID_PRIORITIES].join(', ')}`, 400);
  const ticket = await ticketService.changePriority(req, req.params.id, priority);
  res.json({ success: true, data: ticket });
});

const changeCategory = catchAsync(async (req, res) => {
  const { category } = req.body;
  if (!VALID_CATEGORIES.has(category)) throw new AppError(`category must be one of: ${[...VALID_CATEGORIES].join(', ')}`, 400);
  const ticket = await ticketService.changeCategory(req, req.params.id, category);
  res.json({ success: true, data: ticket });
});

module.exports = {
  list, detail, create, addMessage, editMessage,
  assign, unassign, changeStatus, escalate, changePriority, changeCategory,
};
