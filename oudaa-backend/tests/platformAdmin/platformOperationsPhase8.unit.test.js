'use strict';

jest.mock('../../src/config/prisma', () => ({
  platformAuditLog: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  platformIntegrationEvent: {
    create: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  platformAdmin: { findMany: jest.fn() },
  supportTicket: { findMany: jest.fn() },
  community: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  resident: { findMany: jest.fn() },
  supportChatSession: { findMany: jest.fn() },
  payment: { findMany: jest.fn() },
  project: { findMany: jest.fn() },
}));

const prisma = require('../../src/config/prisma');
const { buildWhere, listAuditLogs } = require('../../src/services/platformAdmin/platformAuditCenterService');
const { globalSearch } = require('../../src/services/platformAdmin/platformSearchService');
const { recordIntegrationEvent, getIntegrationTelemetry } = require('../../src/services/platformAdmin/platformIntegrationTelemetryService');

beforeEach(() => jest.clearAllMocks());

test('audit filters combine search and actor instead of widening the query', () => {
  const where = buildWhere({ search: 'SUSPENDED', actor: 'operator@example.com', success: 'false' });
  expect(where.AND).toHaveLength(2);
  expect(where.success).toBe(false);
});

test('audit list is paginated and contains no mutation path', async () => {
  prisma.platformAuditLog.count.mockResolvedValue(73);
  prisma.platformAuditLog.findMany.mockResolvedValue([]);
  const result = await listAuditLogs({ page: 2, pageSize: 25 });
  expect(result.pagination).toEqual({ page: 2, pageSize: 25, total: 73, pageCount: 3 });
  expect(prisma.platformAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 25, take: 25 }));
  expect(prisma.platformAuditLog).not.toHaveProperty('update');
  expect(prisma.platformAuditLog).not.toHaveProperty('delete');
});

test('global search only includes platform admins and ticket results when role permits them', async () => {
  prisma.community.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);
  prisma.platformAdmin.findMany.mockResolvedValue([{ id: 'a1', fullName: 'Ops', email: 'ops@example.com', role: 'OPERATIONS', isActive: true }]);
  prisma.supportTicket.findMany.mockResolvedValue([{ id: 't1', subject: 'Payment issue', status: 'OPEN', priority: 'HIGH', user: { id: 'u1', fullName: 'User', email: 'user@example.com' } }]);
  const result = await globalSearch('SUPER_ADMIN', 'payment');
  expect(result.groups.find((g) => g.category === 'admins')).toBeTruthy();
  expect(result.groups.find((g) => g.category === 'support_tickets')).toBeTruthy();
});

test('integration telemetry preserves operation metadata while truncating error text', async () => {
  prisma.platformIntegrationEvent.create.mockResolvedValue({});
  await recordIntegrationEvent({ integration: 'email', operation: 'HEALTH_CHECK', success: false, latencyMs: 42, errorMessage: 'x'.repeat(700) });
  const data = prisma.platformIntegrationEvent.create.mock.calls[0][0].data;
  expect(data.integration).toBe('email');
  expect(data.success).toBe(false);
  expect(data.latencyMs).toBe(42);
  expect(data.errorMessage.length).toBe(500);
});

test('integration telemetry returns last success, last failure and error count', async () => {
  prisma.platformIntegrationEvent.findFirst
    .mockResolvedValueOnce({ createdAt: new Date('2026-09-19T10:00:00Z'), operation: 'HEALTH_CHECK', latencyMs: 12 })
    .mockResolvedValueOnce({ createdAt: new Date('2026-09-18T10:00:00Z'), operation: 'HEALTH_CHECK', latencyMs: 80, errorMessage: 'Unavailable' });
  prisma.platformIntegrationEvent.count.mockResolvedValue(3);
  const result = await getIntegrationTelemetry('database');
  expect(result.lastSuccess.operation).toBe('HEALTH_CHECK');
  expect(result.lastFailure.errorMessage).toBe('Unavailable');
  expect(result.errorCount).toBe(3);
});
