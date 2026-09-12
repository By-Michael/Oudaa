// Tests for the email-verified OTP flow that gates phone number changes
// and (for residents) profile picture changes — see
// userController.requestProfileOtp / verifyPhoneOtp. This replaced a
// previously entirely client-side, unverified "OTP" that any valid
// session could route around by calling PATCH /residents/me directly
// (see residents.test.js's regression test for that specific bug).
//
// No BREVO_API_KEY is set in the test environment, so utils/email.js
// runs in stub mode and requestProfileOtp returns the code directly in
// the response body (data.stubOtp) instead of only emailing it — that's
// what lets these tests read the code at all without a real inbox.

const request = require('supertest');
const app = require('../src/app');
const { prisma, resetDb, disconnectDb } = require('./testDb');
const { createCommunityWithAdmin, createResident, loginAs } = require('./factories');

const BASE = '/api/v1/users/me/otp';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
});

async function requestOtp(token, body) {
  const res = await request(app).post(`${BASE}/request`).set('Authorization', `Bearer ${token}`).send(body);
  expect(res.status).toBe(200);
  const otp = res.body.data?.stubOtp;
  expect(otp).toEqual(expect.stringMatching(/^\d{6}$/));
  return otp;
}

describe('POST /users/me/otp/request', () => {
  it('requires type to be PHONE or AVATAR', async () => {
    const { admin } = await createCommunityWithAdmin();
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app).post(`${BASE}/request`).set('Authorization', `Bearer ${token}`).send({ type: 'BOGUS' });
    expect(res.status).toBe(422);
  });

  it('requires a phone number when type is PHONE', async () => {
    const { admin } = await createCommunityWithAdmin();
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app).post(`${BASE}/request`).set('Authorization', `Bearer ${token}`).send({ type: 'PHONE' });
    expect(res.status).toBe(422);
  });

  it('rejects a second request within the cooldown window', async () => {
    const { admin } = await createCommunityWithAdmin();
    const { token } = await loginAs(admin.email, admin.plainPassword);

    await requestOtp(token, { type: 'PHONE', phone: '0911111111' });
    const res = await request(app).post(`${BASE}/request`).set('Authorization', `Bearer ${token}`).send({ type: 'PHONE', phone: '0922222222' });

    expect(res.status).toBe(429);
  });
});

describe('POST /users/me/otp/verify-phone', () => {
  it('applies the pending phone number and keeps phoneSearchKey in sync', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user, resident } = await createResident(community.id, { password: 'ResidentPass1', phone: '0911111111' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const otp = await requestOtp(token, { type: 'PHONE', phone: '0922222222' });

    const res = await request(app).post(`${BASE}/verify-phone`).set('Authorization', `Bearer ${token}`).send({ otp });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('0922222222');

    const updated = await prisma.resident.findUnique({ where: { id: resident.id } });
    expect(updated.phone).toBe('0922222222');
    // phoneSearchKey must be re-derived from the NEW phone, not left
    // pointing at the old one — otherwise phone-based login would break
    // for this resident (see authController.login's phone branch).
    const { phoneSearchKeyFor } = require('../src/utils/phone');
    expect(updated.phoneSearchKey).toBe(phoneSearchKeyFor('0922222222'));
  });

  it('rejects a wrong code and does not change the phone', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user, resident } = await createResident(community.id, { password: 'ResidentPass1', phone: '0911111111' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    await requestOtp(token, { type: 'PHONE', phone: '0922222222' });

    const res = await request(app).post(`${BASE}/verify-phone`).set('Authorization', `Bearer ${token}`).send({ otp: '000000' });
    expect(res.status).toBe(400);

    const untouched = await prisma.resident.findUnique({ where: { id: resident.id } });
    expect(untouched.phone).toBe('0911111111');
  });

  it('rejects reusing the same code twice (single-use)', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const otp = await requestOtp(token, { type: 'PHONE', phone: '0933333333' });

    const first = await request(app).post(`${BASE}/verify-phone`).set('Authorization', `Bearer ${token}`).send({ otp });
    expect(first.status).toBe(200);

    const second = await request(app).post(`${BASE}/verify-phone`).set('Authorization', `Bearer ${token}`).send({ otp });
    expect(second.status).toBe(400);
  });

  it('locks out after 5 wrong attempts, even with a subsequently-correct code', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const otp = await requestOtp(token, { type: 'PHONE', phone: '0944444444' });

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).post(`${BASE}/verify-phone`).set('Authorization', `Bearer ${token}`).send({ otp: '111111' });
      expect(res.status).toBe(400);
    }

    // The 6th attempt, even with the CORRECT code, must now be locked out.
    const res = await request(app).post(`${BASE}/verify-phone`).set('Authorization', `Bearer ${token}`).send({ otp });
    expect(res.status).toBe(429);
  });

  it('rejects an expired code', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const otp = await requestOtp(token, { type: 'PHONE', phone: '0955555555' });

    // Fast-forward the stored row's expiry into the past directly, rather
    // than waiting 10 real minutes for it to actually expire.
    await prisma.profileChangeOtp.updateMany({
      where: { type: 'PHONE' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app).post(`${BASE}/verify-phone`).set('Authorization', `Bearer ${token}`).send({ otp });
    expect(res.status).toBe(400);
  });

  it('one resident cannot use a code that was emailed to a different resident', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user: user1 } = await createResident(community.id, { password: 'ResidentPass1' });
    const { user: user2 } = await createResident(community.id, { password: 'ResidentPass2' });
    const { token: token1 } = await loginAs(user1.email, 'ResidentPass1');
    const { token: token2 } = await loginAs(user2.email, 'ResidentPass2');

    const otp = await requestOtp(token1, { type: 'PHONE', phone: '0966666666' });

    const res = await request(app).post(`${BASE}/verify-phone`).set('Authorization', `Bearer ${token2}`).send({ otp });
    expect(res.status).toBe(400);
  });
});

describe('POST /users/me/avatar — OTP requirement for residents', () => {
  it('rejects an avatar upload from a resident with no otp field at all', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const res = await request(app)
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', Buffer.from('not-a-real-image'), 'avatar.png');

    expect(res.status).toBe(400);
  });

  it('succeeds for a resident who provides a valid AVATAR otp', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const otp = await requestOtp(token, { type: 'AVATAR' });

    const res = await request(app)
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .field('otp', otp)
      .attach('avatar', Buffer.from('not-a-real-image'), 'avatar.png');

    expect(res.status).toBe(200);
    expect(res.body.data.avatarUrl).toEqual(expect.any(String));
  });

  it('does not require an OTP for a committee (ADMIN) upload', async () => {
    const { admin } = await createCommunityWithAdmin();
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app)
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', Buffer.from('not-a-real-image'), 'avatar.png');

    // multer's fileFilter only checks the declared mimetype (which
    // Supertest infers as image/png from the filename) and nothing
    // decodes the actual image bytes server-side, so this succeeds
    // outright for an admin — no OTP gate at all.
    expect(res.status).toBe(200);
    expect(res.body.data.avatarUrl).toEqual(expect.any(String));
  });
});
