'use strict';

jest.mock('../../src/config/prisma', () => ({
  supportTicket: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
  supportTicketMessage: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  platformAuditLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
  user: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
  payment: { findMany: jest.fn().mockResolvedValue([]) },
  auditLog: { findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));

const prisma = require('../../src/config/prisma');
const ticketService = require('../../src/services/platformAdmin/platformSupportTicketService');

function mockReq(overrides = {}) {
  return { platformAdmin: { id: 'op-1', email: 'agent@hivee.local', role: 'SUPPORT_AGENT' }, ip: '127.0.0.1', headers: {}, ...overrides };
}

describe('platformSupportTicketService — internal note privacy', () => {
  afterEach(() => jest.clearAllMocks());

  it('getTicketDetail includes internal notes by default (operator-only caller)', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({
      id: 't1',
      communityId: 'c1',
      userId: 'u1',
      messages: [{ id: 'm1', isInternalNote: true, body: 'internal' }, { id: 'm2', isInternalNote: false, body: 'customer' }],
    });
    const result = await ticketService.getTicketDetail('t1');
    expect(result.messages).toHaveLength(2);
    // Confirm the query itself did NOT filter — passed an empty where for messages
    const call = prisma.supportTicket.findUnique.mock.calls[0][0];
    expect(call.include.messages.where).toEqual({});
  });

  it('getTicketDetail with includeInternalNotes:false builds a filtering where clause', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({ id: 't1', communityId: 'c1', userId: 'u1', messages: [] });
    await ticketService.getTicketDetail('t1', { includeInternalNotes: false });
    const call = prisma.supportTicket.findUnique.mock.calls[0][0];
    expect(call.include.messages.where).toEqual({ isInternalNote: false });
  });

  it('returns null for a ticket that does not exist, rather than throwing', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue(null);
    const result = await ticketService.getTicketDetail('missing');
    expect(result).toBeNull();
  });
});

describe('platformSupportTicketService — inbox sections', () => {
  afterEach(() => jest.clearAllMocks());

  beforeEach(() => {
    prisma.supportTicket.count.mockResolvedValue(0);
    prisma.supportTicket.findMany.mockResolvedValue([]);
  });

  it('"assigned_to_me" filters by the CALLING operator id, not an arbitrary one', async () => {
    await ticketService.listTickets(mockReq({ platformAdmin: { id: 'op-42', email: 'a@b.com' } }), { section: 'assigned_to_me' });
    const where = prisma.supportTicket.findMany.mock.calls[0][0].where;
    expect(where.assignedToId).toBe('op-42');
  });

  it('"unassigned" filters for a null assignee', async () => {
    await ticketService.listTickets(mockReq(), { section: 'unassigned' });
    const where = prisma.supportTicket.findMany.mock.calls[0][0].where;
    expect(where.assignedToId).toBeNull();
  });

  it('"urgent" filters by priority=URGENT', async () => {
    await ticketService.listTickets(mockReq(), { section: 'urgent' });
    expect(prisma.supportTicket.findMany.mock.calls[0][0].where.priority).toBe('URGENT');
  });

  it('an unknown section throws a 400 AppError rather than silently matching everything', async () => {
    await expect(ticketService.listTickets(mockReq(), { section: 'not_a_real_section' })).rejects.toThrow();
  });

  it('an explicit status filter composes with (narrows) a section filter', async () => {
    await ticketService.listTickets(mockReq(), { section: 'open', status: 'IN_PROGRESS' });
    const where = prisma.supportTicket.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('IN_PROGRESS'); // explicit status overrides the section's own {in: [...]} shape
  });
});

describe('platformSupportTicketService — assignment/escalation audits every change', () => {
  afterEach(() => jest.clearAllMocks());

  it('assignTicket records TICKET_ASSIGNED with from/to metadata', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({ id: 't1', communityId: 'c1', assignedToId: null });
    prisma.supportTicket.update.mockResolvedValue({ id: 't1', assignedToId: 'op-2' });
    prisma.user.findUnique.mockResolvedValue(null);
    const platformAdminMock = { findUnique: jest.fn().mockResolvedValue({ id: 'op-2', email: 'bob@hivee.local' }) };
    prisma.platformAdmin = platformAdminMock;

    await ticketService.assignTicket(mockReq(), 't1', 'op-2');

    expect(prisma.platformAuditLog.create).toHaveBeenCalled();
    const auditData = prisma.platformAuditLog.create.mock.calls[0][0].data;
    expect(auditData.action).toBe('TICKET_ASSIGNED');
    expect(auditData.metadata.to).toBe('op-2');
  });

  it('escalateTicket sets status to ESCALATED and audits TICKET_ESCALATED', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({ id: 't1', communityId: 'c1', status: 'OPEN' });
    prisma.supportTicket.update.mockResolvedValue({ id: 't1', status: 'ESCALATED' });

    await ticketService.escalateTicket(mockReq(), 't1');

    expect(prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'ESCALATED' } });
    expect(prisma.platformAuditLog.create.mock.calls[0][0].data.action).toBe('TICKET_ESCALATED');
  });

  it('changeStatus to RESOLVED also stamps resolvedAt', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({ id: 't1', communityId: 'c1', status: 'OPEN' });
    prisma.supportTicket.update.mockResolvedValue({ id: 't1', status: 'RESOLVED' });

    await ticketService.changeStatus(mockReq(), 't1', 'RESOLVED');

    const updateCall = prisma.supportTicket.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe('RESOLVED');
    expect(updateCall.data.resolvedAt).toBeInstanceOf(Date);
  });
});

describe('platformSupportTicketService — message edit ownership', () => {
  afterEach(() => jest.clearAllMocks());

  it('refuses to edit another operator\'s message', async () => {
    prisma.supportTicketMessage.findUnique.mockResolvedValue({ id: 'm1', ticketId: 't1', authorPlatformAdminId: 'someone-else' });
    await expect(
      ticketService.editMessage(mockReq({ platformAdmin: { id: 'op-1', email: 'a@b.com' } }), 't1', 'm1', { body: 'edited' })
    ).rejects.toThrow();
  });

  it('allows editing your own message', async () => {
    prisma.supportTicketMessage.findUnique.mockResolvedValue({ id: 'm1', ticketId: 't1', authorPlatformAdminId: 'op-1' });
    prisma.supportTicketMessage.update.mockResolvedValue({ id: 'm1', body: 'edited' });
    const result = await ticketService.editMessage(mockReq({ platformAdmin: { id: 'op-1', email: 'a@b.com' } }), 't1', 'm1', { body: 'edited' });
    expect(result.body).toBe('edited');
  });
});
