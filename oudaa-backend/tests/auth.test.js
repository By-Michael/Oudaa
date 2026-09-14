const request = require('supertest');
const app = require('../src/app');
const { prisma, resetDb, disconnectDb } = require('./testDb');
const { createCommunityWithAdmin } = require('./factories');

const BASE = '/api/v1/auth';

// Wipe all tables before every test so each test starts from a clean,
// predictable database state and tests can't affect one another.
beforeEach(async () => {
  await resetDb();
});

// Close the Prisma connection once, after the whole file finishes, so Jest
// exits cleanly instead of hanging on an open DB connection.
afterAll(async () => {
  await disconnectDb();
});

describe('POST /auth/register-community', () => {
  const validPayload = {
    community: { name: 'Sunrise Estates' },
    admin: {
      fullName: 'Alice Admin',
      email: 'alice@example.com',
      password: 'SuperSecret1',
    },
  };

  it('creates a community and its first admin user, returning an access token', async () => {
    const res = await request(app).post(`${BASE}/register-community`).send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe('alice@example.com');
    expect(res.body.data.user.role).toBe('ADMIN');
    // Password hash must never be returned to the client.
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.community.name).toBe('Sunrise Estates');

    // Also verify it was actually persisted, not just echoed back.
    const dbUser = await prisma.user.findUnique({ where: { email: 'alice@example.com' } });
    expect(dbUser).not.toBeNull();
    expect(dbUser.passwordHash).not.toBe('SuperSecret1'); // must be hashed
  });

  it('sets a refresh token cookie', async () => {
    const res = await request(app).post(`${BASE}/register-community`).send(validPayload);
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some((c) => c.startsWith('oudaa_refresh_token='))).toBe(true);
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app).post(`${BASE}/register-community`).send(validPayload);
    const res = await request(app).post(`${BASE}/register-community`).send(validPayload);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it.each([
    ['missing community name', { ...validPayload, community: {} }],
    ['short password', { ...validPayload, admin: { ...validPayload.admin, password: 'short' } }],
    ['invalid email', { ...validPayload, admin: { ...validPayload.admin, email: 'not-an-email' } }],
    ['missing admin fullName', { ...validPayload, admin: { ...validPayload.admin, fullName: undefined } }],
  ])('rejects invalid input: %s', async (_label, payload) => {
    const res = await request(app).post(`${BASE}/register-community`).send(payload);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /auth/login', () => {
  it('logs in with a valid email + password', async () => {
    const { admin } = await createCommunityWithAdmin({ password: 'CorrectHorse1' });

    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: admin.email, password: 'CorrectHorse1' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe(admin.email);
  });

  it('rejects a wrong password with 401 and a generic message', async () => {
    const { admin } = await createCommunityWithAdmin({ password: 'CorrectHorse1' });

    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: admin.email, password: 'WrongPassword' });

    expect(res.status).toBe(401);
    // Should not reveal whether it was the email or the password that was wrong.
    expect(res.body.message).toMatch(/invalid credentials/i);
  });

  it('rejects a login for an email that does not exist, with the same generic message', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: 'nobody@example.com', password: 'whatever123' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid credentials/i);
  });

  it('rejects a missing identifier or password with a validation error', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ identifier: 'a@b.com' });
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('returns the current user when a valid access token is provided', async () => {
    const { admin } = await createCommunityWithAdmin({ password: 'CorrectHorse1' });
    const login = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: admin.email, password: 'CorrectHorse1' });
    const token = login.body.data.accessToken;

    const res = await request(app).get(`${BASE}/me`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(admin.email);
  });

  it('rejects a request with no token with 401', async () => {
    const res = await request(app).get(`${BASE}/me`);
    expect(res.status).toBe(401);
  });

  it('rejects a request with a malformed/invalid token with 401', async () => {
    const res = await request(app).get(`${BASE}/me`).set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('issues a new access token given a valid refresh cookie, and rotates it', async () => {
    const { admin } = await createCommunityWithAdmin({ password: 'CorrectHorse1' });
    const agent = request.agent(app); // agent persists cookies across requests, like a browser

    const login = await agent.post(`${BASE}/login`).send({
      identifier: admin.email,
      password: 'CorrectHorse1',
    });
    expect(login.status).toBe(200);

    const refreshRes = await agent.post(`${BASE}/refresh`).send({});
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toEqual(expect.any(String));
    // Rotation: refreshing again with the OLD refresh token (now revoked)
    // must fail. Because `agent` already swapped in the new cookie, we
    // simulate reuse of the old one by calling refresh with the previous
    // cookie explicitly.
    const oldCookie = login.headers['set-cookie'].find((c) => c.startsWith('oudaa_refresh_token='));
    const reuseRes = await request(app).post(`${BASE}/refresh`).set('Cookie', oldCookie).send({});
    expect(reuseRes.status).toBe(401);
  });

  it('rejects when no refresh token is present', async () => {
    const res = await request(app).post(`${BASE}/refresh`).send({});
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('clears the refresh cookie and revokes it', async () => {
    const { admin } = await createCommunityWithAdmin({ password: 'CorrectHorse1' });
    const agent = request.agent(app);
    const login = await agent.post(`${BASE}/login`).send({
      identifier: admin.email,
      password: 'CorrectHorse1',
    });

    const logoutRes = await agent.post(`${BASE}/logout`).send({});
    expect(logoutRes.status).toBe(200);

    // The refresh token that was valid before logout must no longer work.
    const oldCookie = login.headers['set-cookie'].find((c) => c.startsWith('oudaa_refresh_token='));
    const reuseRes = await request(app).post(`${BASE}/refresh`).set('Cookie', oldCookie).send({});
    expect(reuseRes.status).toBe(401);
  });
});

describe('PATCH /auth/change-password', () => {
  it('changes the password when the current password is correct', async () => {
    const { admin } = await createCommunityWithAdmin({ password: 'OldPassword1' });
    const login = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: admin.email, password: 'OldPassword1' });
    const token = login.body.data.accessToken;

    const res = await request(app)
      .patch(`${BASE}/change-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'OldPassword1', newPassword: 'NewPassword1' });
    expect(res.status).toBe(200);

    // Old password no longer works; new one does.
    const oldLogin = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: admin.email, password: 'OldPassword1' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: admin.email, password: 'NewPassword1' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects an incorrect current password with 401 and does not change anything', async () => {
    const { admin } = await createCommunityWithAdmin({ password: 'OldPassword1' });
    const login = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: admin.email, password: 'OldPassword1' });
    const token = login.body.data.accessToken;

    const res = await request(app)
      .patch(`${BASE}/change-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongCurrent', newPassword: 'NewPassword1' });
    expect(res.status).toBe(401);

    const stillWorks = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: admin.email, password: 'OldPassword1' });
    expect(stillWorks.status).toBe(200);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .patch(`${BASE}/change-password`)
      .send({ currentPassword: 'a', newPassword: 'NewPassword1' });
    expect(res.status).toBe(401);
  });

  it('keeps the current session working but signs out other sessions', async () => {
    const { admin } = await createCommunityWithAdmin({ password: 'OldPassword1' });

    // Two separate logins = two separate sessions/devices for the same user.
    const sessionA = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: admin.email, password: 'OldPassword1' });
    const sessionB = await request(app)
      .post(`${BASE}/login`)
      .send({ identifier: admin.email, password: 'OldPassword1' });

    const cookieA = sessionA.headers['set-cookie'].find((c) => c.startsWith('oudaa_refresh_token='));
    const cookieB = sessionB.headers['set-cookie'].find((c) => c.startsWith('oudaa_refresh_token='));

    // Change the password from session A.
    const changeRes = await request(app)
      .patch(`${BASE}/change-password`)
      .set('Authorization', `Bearer ${sessionA.body.data.accessToken}`)
      .set('Cookie', cookieA)
      .send({ currentPassword: 'OldPassword1', newPassword: 'NewPassword1' });
    expect(changeRes.status).toBe(200);
    // A fresh access token comes back so the initiating session never has
    // to hit a revoked refresh token to keep working.
    expect(changeRes.body.data.accessToken).toBeTruthy();

    // Session A's *original* refresh token was rotated (used up) as part
    // of the change, but the rotated cookie returned by change-password
    // itself still works.
    const newCookieA = changeRes.headers['set-cookie'].find((c) => c.startsWith('oudaa_refresh_token='));
    const refreshA = await request(app).post(`${BASE}/refresh`).set('Cookie', newCookieA).send({});
    expect(refreshA.status).toBe(200);

    // Session B (a different device) must be signed out.
    const refreshB = await request(app).post(`${BASE}/refresh`).set('Cookie', cookieB).send({});
    expect(refreshB.status).toBe(401);
  });
});
