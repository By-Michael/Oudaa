const requirePlatformPermission = require('../../src/middleware/platformAdmin/requirePlatformPermission');
const AppError = require('../../src/utils/AppError');
const { PLATFORM_PERMISSIONS } = require('../../src/config/platformPermissions');

function mockReq(platformAdmin) {
  return { platformAdmin };
}

describe('requirePlatformPermission middleware', () => {
  it('rejects with 401 when there is no req.platformAdmin at all', () => {
    const next = jest.fn();
    requirePlatformPermission(PLATFORM_PERMISSIONS.DASHBOARD_VIEW)(mockReq(undefined), {}, next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('rejects with 403 when the role lacks the permission', () => {
    const next = jest.fn();
    requirePlatformPermission(PLATFORM_PERMISSIONS.COMMUNITIES_MANAGE)(
      mockReq({ role: 'SUPPORT_AGENT' }),
      {},
      next
    );
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
  });

  it('calls next() with no error when the role has the permission', () => {
    const next = jest.fn();
    requirePlatformPermission(PLATFORM_PERMISSIONS.DASHBOARD_VIEW)(
      mockReq({ role: 'SUPER_ADMIN' }),
      {},
      next
    );
    expect(next).toHaveBeenCalledWith();
  });
});
