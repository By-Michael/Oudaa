jest.mock('../../src/config/prisma', () => ({
  platformAuditLog: { findMany: jest.fn().mockResolvedValue([]) },
  supportChatSession: { findMany: jest.fn().mockResolvedValue([]) },
}));

const prisma = require('../../src/config/prisma');
const { getRecentActivity } = require('../../src/services/platformAdmin/platformActivityService');

describe('platformActivityService.getRecentActivity — permission gating', () => {
  afterEach(() => jest.clearAllMocks());

  it('includes auditEvents/securityEvents only for a role with AUDIT_VIEW', async () => {
    const withAudit = await getRecentActivity('SECURITY_AUDITOR');
    expect(withAudit.auditEvents).toBeDefined();
    expect(withAudit.securityEvents).toBeDefined();

    jest.clearAllMocks();
    const withoutAudit = await getRecentActivity('FINANCE_OPERATOR');
    expect(withoutAudit.auditEvents).toBeUndefined();
    expect(withoutAudit.securityEvents).toBeUndefined();
  });

  it('includes supportActivity only for a role with SUPPORT_VIEW', async () => {
    const withSupport = await getRecentActivity('SUPPORT_AGENT');
    expect(withSupport.supportActivity).toBeDefined();

    jest.clearAllMocks();
    const withoutSupport = await getRecentActivity('OPERATIONS');
    expect(withoutSupport.supportActivity).toBeUndefined();
  });

  it('always reports recentErrorsAvailable: false (no honest data source exists)', async () => {
    const result = await getRecentActivity('SUPER_ADMIN');
    expect(result.recentErrorsAvailable).toBe(false);
  });

  it('does not query the DB at all for a role with neither permission', async () => {
    await getRecentActivity('NOT_A_ROLE');
    expect(prisma.platformAuditLog.findMany).not.toHaveBeenCalled();
    expect(prisma.supportChatSession.findMany).not.toHaveBeenCalled();
  });

  it('respects the limit parameter passed through to the queries', async () => {
    await getRecentActivity('SUPER_ADMIN', { limit: 25 });
    const call = prisma.platformAuditLog.findMany.mock.calls[0][0];
    expect(call.take).toBe(25);
  });
});
