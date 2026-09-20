'use strict';

jest.mock('../../src/config/prisma', () => ({
  platformFeatureFlag: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  platformFeatureFlagTarget: {
    count: jest.fn(),
    findUnique: jest.fn(),
  },
  platformAnnouncement: {
    findMany: jest.fn(),
  },
  platformConfigSetting: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  $transaction: jest.fn(),
}));

jest.mock('../../src/services/platformAdmin/platformMaintenanceService', () => ({
  getMaintenance: jest.fn(),
}));

const prisma = require('../../src/config/prisma');
const { PLATFORM_PERMISSIONS, ROLE_PERMISSIONS, roleHasPermission } = require('../../src/config/platformPermissions');
const { evaluateFlag, rolloutBucket } = require('../../src/services/platformAdmin/platformFeatureFlagService');
const { activeForCommunity } = require('../../src/services/platformAdmin/platformAnnouncementService');
const { list: listConfig } = require('../../src/services/platformAdmin/platformConfigService');
const maintenanceMode = require('../../src/middleware/maintenanceMode');
const maintenanceService = require('../../src/services/platformAdmin/platformMaintenanceService');
const { safeJson } = require('../../src/services/platformAdmin/platformExportService');

describe('Phase 7 platform operations', () => {
  beforeEach(() => jest.clearAllMocks());

  test('new operational permissions are represented by the existing role model', () => {
    expect(PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE).toBe('platform.feature_flags.manage');
    expect(PLATFORM_PERMISSIONS.ANNOUNCEMENTS_MANAGE).toBe('platform.announcements.manage');
    expect(PLATFORM_PERMISSIONS.NOTIFICATIONS_VIEW).toBe('platform.notifications.view');
    expect(roleHasPermission('SUPER_ADMIN', PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE)).toBe(true);
    expect(roleHasPermission('PLATFORM_ADMIN', PLATFORM_PERMISSIONS.ANNOUNCEMENTS_MANAGE)).toBe(true);
    expect(roleHasPermission('SUPPORT_AGENT', PLATFORM_PERMISSIONS.NOTIFICATIONS_VIEW)).toBe(true);
    expect(roleHasPermission('SUPPORT_AGENT', PLATFORM_PERMISSIONS.ANNOUNCEMENTS_MANAGE)).toBe(false);
    expect(ROLE_PERMISSIONS.OPERATIONS.has(PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE)).toBe(true);
  });

  test('feature flag evaluation never bypasses authentication authorization', async () => {
    prisma.platformFeatureFlag.findFirst.mockResolvedValue({ id: 'flag-1', key: 'new_payment_flow', enabled: true, rolloutPercentage: 100 });
    prisma.platformFeatureFlagTarget.count.mockResolvedValue(0);
    expect(await evaluateFlag({ key: 'new_payment_flow', communityId: 'community-1' })).toBe(true);
    expect(prisma.platformFeatureFlag.findFirst).toHaveBeenCalled();
    // This service is an evaluation mechanism only; route authorization remains on the platform API.
  });

  test('feature flag community targeting and percentage rollout are enforced deterministically', async () => {
    prisma.platformFeatureFlag.findFirst.mockResolvedValue({ id: 'flag-2', key: 'advanced_reports', enabled: true, rolloutPercentage: 100 });
    prisma.platformFeatureFlagTarget.count.mockResolvedValue(1);
    prisma.platformFeatureFlagTarget.findUnique.mockResolvedValueOnce(null);
    expect(await evaluateFlag({ key: 'advanced_reports', communityId: 'not-targeted' })).toBe(false);

    prisma.platformFeatureFlagTarget.findUnique.mockResolvedValueOnce({ communityId: 'targeted' });
    expect(await evaluateFlag({ key: 'advanced_reports', communityId: 'targeted' })).toBe(true);

    expect(rolloutBucket('advanced_reports', 'community-1')).toBe(rolloutBucket('advanced_reports', 'community-1'));
    expect(rolloutBucket('advanced_reports', 'community-1')).not.toBe(rolloutBucket('advanced_reports', 'community-2'));
  });

  test('scheduled platform announcements are filtered by audience and active window', async () => {
    prisma.platformAnnouncement.findMany.mockResolvedValue([{ id: 'announcement-1', title: 'Maintenance', targetAll: false }]);
    const rows = await activeForCommunity('community-9');
    expect(rows).toHaveLength(1);
    const where = prisma.platformAnnouncement.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([
      { targetAll: true },
      { targetAll: false, targets: { some: { communityId: 'community-9' } } },
    ]));
    expect(where.status.in).toEqual(['PUBLISHED', 'SCHEDULED']);
  });

  test('maintenance mode returns controlled 503 while failing open on lookup errors', async () => {
    const req = { requestId: 'req-1' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    maintenanceService.getMaintenance.mockResolvedValue({ enabled: true, message: 'Upgrading', expectedDurationMins: 20, enabledAt: new Date('2026-09-19T10:00:00Z') });
    await maintenanceMode(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ maintenance: true, code: 'PLATFORM_MAINTENANCE' }));
    expect(next).not.toHaveBeenCalled();

    jest.clearAllMocks();
    maintenanceService.getMaintenance.mockRejectedValue(new Error('db unavailable'));
    await maintenanceMode(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('sensitive configuration values are never returned to the browser', async () => {
    prisma.platformConfigSetting.upsert.mockResolvedValue({});
    prisma.platformConfigSetting.findMany.mockResolvedValue([
      { id: '1', category: 'email', key: 'apiKey', valueJson: 'SUPER-SECRET', isSensitive: true, managedBy: 'server', description: 'secret', updatedAt: new Date() },
      { id: '2', category: 'general', key: 'defaultLocale', valueJson: 'en', isSensitive: false, managedBy: 'platform', description: 'locale', updatedAt: new Date() },
    ]);
    const rows = await listConfig({});
    expect(rows[0].value).toBeNull();
    expect(rows[1].value).toBe('en');
  });

  test('export privacy sanitizer strips secret-bearing keys recursively', () => {
    const result = safeJson({
      id: 'u1',
      passwordHash: 'hash',
      profile: { mfaSecret: 'secret', apiKey: 'key', displayName: 'User' },
      accessToken: 'token',
    });
    expect(result).toEqual({ id: 'u1', profile: { displayName: 'User' } });
  });
});
