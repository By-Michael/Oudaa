'use strict';

jest.mock('../../src/config/prisma', () => ({
  supportTicket: {
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
    findMany: jest.fn().mockResolvedValue([]),
  },
  supportChatSession: { count: jest.fn().mockResolvedValue(0) },
  $queryRaw: jest.fn().mockResolvedValue([]),
}));

const prisma = require('../../src/config/prisma');
const { getOverview, getVolumeChart } = require('../../src/services/platformAdmin/platformSupportAnalyticsService');

describe('platformSupportAnalyticsService.getOverview', () => {
  afterEach(() => jest.clearAllMocks());

  it('reports null averages (not 0 or NaN) when there is no resolved/responded data yet', async () => {
    const result = await getOverview({ days: 30 });
    expect(result.averageResponseTimeMs).toBeNull();
    expect(result.averageResolutionTimeMs).toBeNull();
  });

  it('turns groupBy rows into a plain {ENUM: count} map for byPriority/byCategory', async () => {
    prisma.supportTicket.groupBy
      .mockResolvedValueOnce([{ priority: 'HIGH', _count: { _all: 3 } }, { priority: 'LOW', _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ category: 'PAYMENT', _count: { _all: 2 } }]);
    const result = await getOverview({ days: 30 });
    expect(result.byPriority).toEqual({ HIGH: 3, LOW: 1 });
    expect(result.byCategory).toEqual({ PAYMENT: 2 });
  });

  it('computes averageResponseTimeMs from real timestamp deltas returned by the raw query', async () => {
    const now = Date.now();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 't1', ticket_created: new Date(now - 60000), first_agent_response: new Date(now) }, // 60s
      { id: 't2', ticket_created: new Date(now - 120000), first_agent_response: new Date(now) }, // 120s
    ]);
    const result = await getOverview({ days: 30 });
    expect(result.averageResponseTimeMs).toBe(90000); // average of 60s and 120s
  });

  it('ignores a negative delta (bad data) rather than skewing the average', async () => {
    const now = Date.now();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 't1', ticket_created: new Date(now), first_agent_response: new Date(now - 60000) }, // negative, malformed
      { id: 't2', ticket_created: new Date(now - 60000), first_agent_response: new Date(now) }, // valid 60s
    ]);
    const result = await getOverview({ days: 30 });
    expect(result.averageResponseTimeMs).toBe(60000);
  });
});

describe('platformSupportAnalyticsService.getVolumeChart', () => {
  it('maps raw grouped rows into a date/count series', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ day: '2026-09-16', count: 3 }]);
    const result = await getVolumeChart({ days: 7 });
    expect(result.series).toEqual([{ date: '2026-09-16', count: 3 }]);
  });

  it('returns an empty series (not an error) when there is no data yet', async () => {
    const result = await getVolumeChart({ days: 7 });
    expect(result.series).toEqual([]);
  });
});
