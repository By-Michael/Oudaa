// Mock prisma BEFORE requiring the service, so this suite needs no real
// database — it's testing the permission-filtering logic of
// platformSearchService.globalSearch, not Postgres itself (that part is
// covered by the DB-backed integration suite).
jest.mock('../../src/config/prisma', () => ({
  community: { findMany: jest.fn().mockResolvedValue([]) },
  user: { findMany: jest.fn().mockResolvedValue([]) },
  resident: { findMany: jest.fn().mockResolvedValue([]) },
  supportChatSession: { findMany: jest.fn().mockResolvedValue([]) },
  platformAuditLog: { findMany: jest.fn().mockResolvedValue([]) },
  payment: { findMany: jest.fn().mockResolvedValue([]) },
  project: { findMany: jest.fn().mockResolvedValue([]) },
}));

const prisma = require('../../src/config/prisma');
const { globalSearch } = require('../../src/services/platformAdmin/platformSearchService');

describe('platformSearchService.globalSearch — permission filtering', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns tooShort for a query under the minimum length, without touching the DB', async () => {
    const result = await globalSearch('SUPER_ADMIN', 'a');
    expect(result.tooShort).toBe(true);
    expect(result.groups).toEqual([]);
    expect(prisma.community.findMany).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN queries every category', async () => {
    await globalSearch('SUPER_ADMIN', 'greenwood');
    expect(prisma.community.findMany).toHaveBeenCalled();
    expect(prisma.user.findMany).toHaveBeenCalled();
    expect(prisma.resident.findMany).toHaveBeenCalled();
    expect(prisma.supportChatSession.findMany).toHaveBeenCalled();
    expect(prisma.platformAuditLog.findMany).toHaveBeenCalled();
    expect(prisma.payment.findMany).toHaveBeenCalled();
    expect(prisma.project.findMany).toHaveBeenCalled();
  });

  it('FINANCE_OPERATOR (no support/audit/users view) never queries support, audit, users, or residents', async () => {
    await globalSearch('FINANCE_OPERATOR', 'greenwood');
    expect(prisma.community.findMany).toHaveBeenCalled(); // COMMUNITIES_VIEW
    expect(prisma.payment.findMany).toHaveBeenCalled(); // reuses COMMUNITIES_VIEW
    expect(prisma.project.findMany).toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.resident.findMany).not.toHaveBeenCalled();
    expect(prisma.supportChatSession.findMany).not.toHaveBeenCalled();
    expect(prisma.platformAuditLog.findMany).not.toHaveBeenCalled();
  });

  it('SUPPORT_AGENT queries support, users, residents, communities but never audit', async () => {
    await globalSearch('SUPPORT_AGENT', 'jane');
    expect(prisma.supportChatSession.findMany).toHaveBeenCalled();
    expect(prisma.user.findMany).toHaveBeenCalled();
    expect(prisma.resident.findMany).toHaveBeenCalled();
    expect(prisma.community.findMany).toHaveBeenCalled();
    expect(prisma.platformAuditLog.findMany).not.toHaveBeenCalled();
  });

  it('SECURITY_AUDITOR queries audit and users but never support (no SUPPORT_VIEW permission)', async () => {
    await globalSearch('SECURITY_AUDITOR', 'role changed');
    expect(prisma.platformAuditLog.findMany).toHaveBeenCalled();
    expect(prisma.user.findMany).toHaveBeenCalled();
    expect(prisma.supportChatSession.findMany).not.toHaveBeenCalled();
    // SECURITY_AUDITOR does have COMMUNITIES_VIEW, which payments/projects
    // search reuse (no dedicated PAYMENTS_VIEW permission exists) — so
    // this role legitimately CAN search payments/projects too.
    expect(prisma.payment.findMany).toHaveBeenCalled();
  });

  it('an unknown/garbage role queries nothing and returns no groups', async () => {
    const result = await globalSearch('NOT_A_ROLE', 'anything');
    expect(result.groups).toEqual([]);
    expect(prisma.community.findMany).not.toHaveBeenCalled();
  });

  it('omits empty-result categories from the response groups', async () => {
    prisma.community.findMany.mockResolvedValueOnce([{ id: 'c1', name: 'Greenwood', slug: 'greenwood', status: 'ACTIVE' }]);
    const result = await globalSearch('SUPER_ADMIN', 'greenwood');
    const communityGroup = result.groups.find((g) => g.category === 'communities');
    expect(communityGroup).toBeTruthy();
    expect(communityGroup.results).toHaveLength(1);
    // every other category returned [] from the mock, so shouldn't appear
    expect(result.groups.filter((g) => g.category !== 'communities')).toEqual([]);
  });
});
