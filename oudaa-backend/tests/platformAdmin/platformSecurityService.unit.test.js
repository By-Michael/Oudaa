jest.mock('../../src/config/prisma', () => ({
  platformAdminSession: {
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  platformAuditLog: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  platformAdmin: {
    count: jest.fn(),
    groupBy: jest.fn(),
  },
}));

const prisma = require('../../src/config/prisma');
const service = require('../../src/services/platformAdmin/platformSecurityService');
const { SECURITY_EVENT_CATEGORIES } = require('../../src/config/platformSecurityEvents');

describe('platformSecurityService.revokeSessionById', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns null for a session that does not exist', async () => {
    prisma.platformAdminSession.findUnique.mockResolvedValue(null);
    const result = await service.revokeSessionById('missing');
    expect(result).toBeNull();
    expect(prisma.platformAdminSession.update).not.toHaveBeenCalled();
  });

  it('revokes an active session, invalidating it server-side', async () => {
    prisma.platformAdminSession.findUnique.mockResolvedValue({ id: 's1', revoked: false });
    prisma.platformAdminSession.update.mockResolvedValue({ id: 's1', revoked: true });

    await service.revokeSessionById('s1');

    expect(prisma.platformAdminSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { revoked: true, revokedAt: expect.any(Date) },
    });
  });

  it('is idempotent — revoking an already-revoked session is a no-op, not an error', async () => {
    const already = { id: 's1', revoked: true };
    prisma.platformAdminSession.findUnique.mockResolvedValue(already);

    const result = await service.revokeSessionById('s1');

    expect(result).toBe(already);
    expect(prisma.platformAdminSession.update).not.toHaveBeenCalled();
  });
});

describe('platformSecurityService.listSecurityEvents', () => {
  afterEach(() => jest.clearAllMocks());

  it('with no category filter, ORs together every known category', async () => {
    prisma.platformAuditLog.count.mockResolvedValue(0);
    prisma.platformAuditLog.findMany.mockResolvedValue([]);

    await service.listSecurityEvents({});

    const call = prisma.platformAuditLog.findMany.mock.calls[0][0];
    expect(call.where.OR).toHaveLength(Object.keys(SECURITY_EVENT_CATEGORIES).length);
  });

  it('narrows to only the requested categories', async () => {
    prisma.platformAuditLog.count.mockResolvedValue(0);
    prisma.platformAuditLog.findMany.mockResolvedValue([]);

    await service.listSecurityEvents({ categories: ['SESSION_REVOCATION'] });

    const call = prisma.platformAuditLog.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([SECURITY_EVENT_CATEGORIES.SESSION_REVOCATION.where]);
  });

  it('silently drops unknown category keys rather than erroring', async () => {
    prisma.platformAuditLog.count.mockResolvedValue(0);
    prisma.platformAuditLog.findMany.mockResolvedValue([]);

    await service.listSecurityEvents({ categories: ['NOT_A_CATEGORY'] });

    const call = prisma.platformAuditLog.findMany.mock.calls[0][0];
    // No valid categories survived the filter, so it falls back to "all".
    expect(call.where.OR).toHaveLength(Object.keys(SECURITY_EVENT_CATEGORIES).length);
  });
});
