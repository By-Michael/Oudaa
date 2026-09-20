const requireRecentReauthentication = require('../../src/middleware/platformAdmin/requireRecentReauthentication');
const AppError = require('../../src/utils/AppError');

function run(platformSession, maxAgeMinutes) {
  const req = { platformSession };
  const next = jest.fn();
  requireRecentReauthentication(maxAgeMinutes)(req, {}, next);
  return next;
}

describe('requireRecentReauthentication middleware', () => {
  it('rejects 401 when there is no session at all', () => {
    const next = run(undefined, 15);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('allows a session authenticated well within the window', () => {
    const next = run({ authenticatedAt: new Date(Date.now() - 60 * 1000) }, 15);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a session authenticated outside the window', () => {
    const next = run({ authenticatedAt: new Date(Date.now() - 20 * 60 * 1000) }, 15);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.details.code).toBe('REAUTHENTICATION_REQUIRED');
  });

  it('rejects when authenticatedAt is not a valid date', () => {
    const next = run({ authenticatedAt: 'not-a-date' }, 15);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });
});
