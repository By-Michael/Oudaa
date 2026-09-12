// Unit tests for middleware/authorize.js in isolation — no DB, no HTTP
// server, just calling the middleware function directly with fake
// req/res/next objects. This is the fastest, most direct way to lock in
// its exact behavior, and it runs even if the test database isn't
// configured at all (this file needs no jest env.setup DB connection).

const authorize = require('../src/middleware/authorize');
const AppError = require('../src/utils/AppError');

function mockReq(user) {
  return { user };
}

describe('authorize middleware', () => {
  it('calls next() with an AppError(401) when there is no req.user at all', () => {
    const next = jest.fn();
    authorize('ADMIN')(mockReq(undefined), {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('calls next() with an AppError(403) when the role is not in the allowed list', () => {
    const next = jest.fn();
    authorize('ADMIN')(mockReq({ role: 'RESIDENT' }), {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
  });

  it('calls next() with no arguments when the role matches', () => {
    const next = jest.fn();
    authorize('ADMIN')(mockReq({ role: 'ADMIN' }), {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(); // no error passed
  });

  it('accepts a role that matches ANY of multiple allowed roles', () => {
    const next = jest.fn();
    authorize('ADMIN', 'RESIDENT')(mockReq({ role: 'RESIDENT' }), {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('is case-sensitive — "admin" (lowercase) does not match "ADMIN"', () => {
    const next = jest.fn();
    authorize('ADMIN')(mockReq({ role: 'admin' }), {}, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
  });

  it('rejects when called with zero allowed roles (nobody could ever pass)', () => {
    const next = jest.fn();
    authorize()(mockReq({ role: 'ADMIN' }), {}, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
  });
});
