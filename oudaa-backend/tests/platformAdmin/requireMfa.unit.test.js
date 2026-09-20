jest.mock('../../src/services/platformAdmin/platformSecuritySettingsService', () => ({
  getSecuritySettings: jest.fn().mockResolvedValue({ mfaRequiredForAllAdmins: false }),
}));

const { getSecuritySettings } = require('../../src/services/platformAdmin/platformSecuritySettingsService');
const requireMfa = require('../../src/middleware/platformAdmin/requireMfa');
const AppError = require('../../src/utils/AppError');

async function run(platformAdmin, platformSession) {
  const req = { platformAdmin, platformSession };
  const next = jest.fn();
  await requireMfa(req, {}, next);
  return next;
}

describe('requireMfa middleware', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects 401 with no authenticated admin/session', async () => {
    const next = await run(undefined, undefined);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('blocks a mandatory-MFA role that has not enrolled MFA yet', async () => {
    const next = await run({ role: 'SUPER_ADMIN', mfaEnabled: false }, { mfaVerified: false });
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.details.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('blocks a mandatory-MFA role enrolled but not verified this session', async () => {
    const next = await run({ role: 'SUPER_ADMIN', mfaEnabled: true }, { mfaVerified: false });
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.details.code).toBe('MFA_VERIFICATION_REQUIRED');
  });

  it('allows a mandatory-MFA role enrolled and verified this session', async () => {
    const next = await run({ role: 'SUPER_ADMIN', mfaEnabled: true }, { mfaVerified: true });
    expect(next).toHaveBeenCalledWith();
  });

  it('allows a non-mandatory role with MFA disabled entirely', async () => {
    const next = await run({ role: 'SUPPORT_AGENT', mfaEnabled: false }, { mfaVerified: false });
    expect(next).toHaveBeenCalledWith();
  });

  it('still enforces verification for a non-mandatory role that opted into MFA', async () => {
    const next = await run({ role: 'SUPPORT_AGENT', mfaEnabled: true }, { mfaVerified: false });
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.details.code).toBe('MFA_VERIFICATION_REQUIRED');
  });

  it('blocks any role when mfaRequiredForAllAdmins is on, even if not role-mandatory', async () => {
    getSecuritySettings.mockResolvedValueOnce({ mfaRequiredForAllAdmins: true });
    const next = await run({ role: 'SUPPORT_AGENT', mfaEnabled: false }, { mfaVerified: false });
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.details.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('blocks a session when mfaReenrollmentRequired is set, even if previously enrolled', async () => {
    const next = await run(
      { role: 'SUPPORT_AGENT', mfaEnabled: false, mfaReenrollmentRequired: true },
      { mfaVerified: false }
    );
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.details.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });
});
