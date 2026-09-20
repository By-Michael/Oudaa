const requireMustChangePassword = require('../../src/middleware/platformAdmin/requireMustChangePassword');
const AppError = require('../../src/utils/AppError');

function run(platformAdmin) {
  const req = { platformAdmin };
  const next = jest.fn();
  requireMustChangePassword(req, {}, next);
  return next;
}

describe('requireMustChangePassword middleware', () => {
  it('rejects 401 with no authenticated admin', () => {
    const next = run(undefined);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('blocks the request when mustChangePassword is true', () => {
    const next = run({ mustChangePassword: true });
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.details.code).toBe('PASSWORD_RESET_REQUIRED');
  });

  it('allows the request through when mustChangePassword is false', () => {
    const next = run({ mustChangePassword: false });
    expect(next).toHaveBeenCalledWith();
  });
});
