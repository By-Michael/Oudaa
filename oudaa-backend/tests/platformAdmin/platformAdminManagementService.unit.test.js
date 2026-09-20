jest.mock('../../src/config/prisma', () => ({
  platformAdmin: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  platformAdminSession: {
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  platformAuditLog: {
    findMany: jest.fn(),
  },
}));

jest.mock('../../src/services/platformAdmin/platformSecuritySettingsService', () => ({
  getSecuritySettings: jest.fn().mockResolvedValue({
    passwordMinLength: 12,
    passwordRequireUppercase: true,
    passwordRequireNumber: true,
    passwordRequireSymbol: false,
  }),
}));

const prisma = require('../../src/config/prisma');
const service = require('../../src/services/platformAdmin/platformAdminManagementService');
const AppError = require('../../src/utils/AppError');

const SUPER_ADMIN_ACTOR = { id: 'actor-super', role: 'SUPER_ADMIN' };
const PLATFORM_ADMIN_ACTOR = { id: 'actor-platform', role: 'PLATFORM_ADMIN' };

function admin(overrides = {}) {
  return {
    id: 'target-1',
    fullName: 'Target Admin',
    email: 'target@example.com',
    role: 'SUPPORT_AGENT',
    isActive: true,
    passwordHash: 'hash',
    mfaEnabled: false,
    mfaSecretEnc: null,
    mfaRecoveryCodeHashes: [],
    mustChangePassword: false,
    mfaReenrollmentRequired: false,
    ...overrides,
  };
}

describe('platformAdminManagementService — self-escalation guard', () => {
  afterEach(() => jest.clearAllMocks());

  it('blocks an admin from changing their own role, even to a lower one', async () => {
    await expect(service.changeRole(SUPER_ADMIN_ACTOR.id, 'SUPPORT_AGENT', SUPER_ADMIN_ACTOR))
      .rejects.toThrow(AppError);
    expect(prisma.platformAdmin.update).not.toHaveBeenCalled();
  });

  it('blocks an admin from disabling their own account', async () => {
    await expect(service.setActiveStatus(SUPER_ADMIN_ACTOR.id, false, SUPER_ADMIN_ACTOR))
      .rejects.toThrow(/cannot enable or disable your own account/i);
    expect(prisma.platformAdmin.update).not.toHaveBeenCalled();
  });

  it('blocks a PLATFORM_ADMIN from promoting someone to SECURITY_AUDITOR (permission superset it lacks)', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(admin());
    await expect(service.changeRole('target-1', 'SECURITY_AUDITOR', PLATFORM_ADMIN_ACTOR))
      .rejects.toMatchObject({ statusCode: 403, details: { code: 'SELF_ESCALATION_BLOCKED' } });
    expect(prisma.platformAdmin.update).not.toHaveBeenCalled();
  });

  it('blocks a PLATFORM_ADMIN from creating a new SUPER_ADMIN', async () => {
    await expect(
      service.createAdmin(
        { fullName: 'New Admin', email: 'new@example.com', password: 'Abcdefgh1234', role: 'SUPER_ADMIN' },
        PLATFORM_ADMIN_ACTOR
      )
    ).rejects.toThrow(/you do not have/i);
    expect(prisma.platformAdmin.create).not.toHaveBeenCalled();
  });

  it('allows a SUPER_ADMIN to change another admin\'s role and revokes nothing extra', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(admin());
    prisma.platformAdmin.update.mockResolvedValue(admin({ role: 'PLATFORM_ADMIN' }));
    const result = await service.changeRole('target-1', 'PLATFORM_ADMIN', SUPER_ADMIN_ACTOR);
    expect(result.previousRole).toBe('SUPPORT_AGENT');
    expect(result.admin.role).toBe('PLATFORM_ADMIN');
    expect(prisma.platformAdmin.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { role: 'PLATFORM_ADMIN' },
    });
  });

  it('rejects changing the role of a target that does not exist', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    await expect(service.changeRole('missing', 'SUPPORT_AGENT', SUPER_ADMIN_ACTOR))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('platformAdminManagementService — disable revokes sessions', () => {
  afterEach(() => jest.clearAllMocks());

  it('revokes all active sessions server-side when disabling an admin', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(admin());
    prisma.platformAdmin.update.mockResolvedValue(admin({ isActive: false }));
    prisma.platformAdminSession.updateMany.mockResolvedValue({ count: 2 });

    await service.setActiveStatus('target-1', false, SUPER_ADMIN_ACTOR);

    expect(prisma.platformAdminSession.updateMany).toHaveBeenCalledWith({
      where: { platformAdminId: 'target-1', revoked: false },
      data: { revoked: true, revokedAt: expect.any(Date) },
    });
  });

  it('does not touch sessions when re-enabling an admin', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(admin({ isActive: false }));
    prisma.platformAdmin.update.mockResolvedValue(admin({ isActive: true }));

    await service.setActiveStatus('target-1', true, SUPER_ADMIN_ACTOR);

    expect(prisma.platformAdminSession.updateMany).not.toHaveBeenCalled();
  });
});

describe('platformAdminManagementService — forced re-credentialing', () => {
  afterEach(() => jest.clearAllMocks());

  it('requirePasswordReset sets the flag and revokes active sessions', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(admin());
    prisma.platformAdmin.update.mockResolvedValue(admin({ mustChangePassword: true }));
    prisma.platformAdminSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.requirePasswordReset('target-1', SUPER_ADMIN_ACTOR);

    expect(result.mustChangePassword).toBe(true);
    expect(prisma.platformAdmin.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { mustChangePassword: true },
    });
    expect(prisma.platformAdminSession.updateMany).toHaveBeenCalledWith({
      where: { platformAdminId: 'target-1', revoked: false },
      data: { revoked: true, revokedAt: expect.any(Date) },
    });
  });

  it('an admin cannot flag their own account for a forced password reset', async () => {
    await expect(service.requirePasswordReset(SUPER_ADMIN_ACTOR.id, SUPER_ADMIN_ACTOR))
      .rejects.toThrow(/cannot flag your own account/i);
  });

  it('requireMfaReenrollment wipes the MFA secret/codes and flips existing sessions to unverified', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(admin({ mfaEnabled: true, mfaSecretEnc: 'enc', mfaRecoveryCodeHashes: ['h1'] }));
    prisma.platformAdmin.update.mockResolvedValue(admin({ mfaEnabled: false, mfaReenrollmentRequired: true }));

    const result = await service.requireMfaReenrollment('target-1', SUPER_ADMIN_ACTOR);

    expect(result.mfaReenrollmentRequired).toBe(true);
    expect(prisma.platformAdmin.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: {
        mfaEnabled: false,
        mfaSecretEnc: null,
        mfaRecoveryCodeHashes: [],
        mfaEnrolledAt: null,
        mfaReenrollmentRequired: true,
      },
    });
    expect(prisma.platformAdminSession.updateMany).toHaveBeenCalledWith({
      where: { platformAdminId: 'target-1', revoked: false },
      data: { mfaVerified: false },
    });
  });

  it('an admin cannot flag their own account for forced MFA re-enrollment', async () => {
    await expect(service.requireMfaReenrollment(SUPER_ADMIN_ACTOR.id, SUPER_ADMIN_ACTOR))
      .rejects.toThrow(/cannot flag your own account/i);
  });
});

describe('platformAdminManagementService — createAdmin', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects a duplicate email', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(admin({ email: 'new@example.com' }));
    await expect(
      service.createAdmin({ fullName: 'X', email: 'new@example.com', password: 'Abcdefgh1234', role: 'SUPPORT_AGENT' }, SUPER_ADMIN_ACTOR)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a password that fails policy before ever hashing/creating', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    await expect(
      service.createAdmin({ fullName: 'X', email: 'new@example.com', password: 'weak', role: 'SUPPORT_AGENT' }, SUPER_ADMIN_ACTOR)
    ).rejects.toThrow(AppError);
    expect(prisma.platformAdmin.create).not.toHaveBeenCalled();
  });
});
