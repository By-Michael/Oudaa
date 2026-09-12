const request = require('supertest');
const app = require('../src/app');
const { prisma, resetDb, disconnectDb } = require('./testDb');
const { createCommunityWithAdmin, createResident, loginAs } = require('./factories');

const BASE = '/api/v1/residents';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
});

describe('POST /residents (create)', () => {
  it('lets an admin create a resident in their own community', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Resident', email: 'new.resident@example.com', password: 'ResidentPass1', unitNumber: 'A-101' });

    expect(res.status).toBe(201);
    expect(res.body.data.unitNumber ?? res.body.data.resident?.unitNumber).toBeTruthy();

    const dbUser = await prisma.user.findUnique({ where: { email: 'new.resident@example.com' } });
    expect(dbUser).not.toBeNull();
    expect(dbUser.communityId).toBe(community.id);
    expect(dbUser.role).toBe('RESIDENT');
  });

  it('rejects a resident trying to create another resident', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Someone', email: 'someone@example.com', password: 'Password123', unitNumber: 'B-1' });

    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post(BASE).send({ fullName: 'x', email: 'x@example.com', password: 'Password123', unitNumber: 'A-1' });
    expect(res.status).toBe(401);
  });

  it('rejects a duplicate email with 409', async () => {
    const { admin } = await createCommunityWithAdmin();
    const { token } = await loginAs(admin.email, admin.plainPassword);
    const payload = { fullName: 'Dup', email: 'dup@example.com', password: 'Password123', unitNumber: 'A-1' };

    await request(app).post(BASE).set('Authorization', `Bearer ${token}`).send(payload);
    const res = await request(app).post(BASE).set('Authorization', `Bearer ${token}`).send(payload);

    expect(res.status).toBe(409);
  });

  it.each([
    ['missing fullName', { email: 'a@b.com', password: 'Password123', unitNumber: 'A-1' }],
    ['short password', { fullName: 'A', email: 'a@b.com', password: 'short', unitNumber: 'A-1' }],
    ['invalid email', { fullName: 'A', email: 'not-an-email', password: 'Password123', unitNumber: 'A-1' }],
    ['missing unitNumber', { fullName: 'A', email: 'a@b.com', password: 'Password123' }],
  ])('rejects invalid input: %s', async (_label, payload) => {
    const { admin } = await createCommunityWithAdmin();
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app).post(BASE).set('Authorization', `Bearer ${token}`).send(payload);
    expect(res.status).toBe(400);
  });
});

describe('GET /residents (list)', () => {
  it('only returns residents from the admin\'s own community', async () => {
    const { community: communityA, admin: adminA } = await createCommunityWithAdmin();
    const { community: communityB } = await createCommunityWithAdmin();
    await createResident(communityA.id, { fullName: 'Alice From A' });
    await createResident(communityB.id, { fullName: 'Bob From B' });

    const { token } = await loginAs(adminA.email, adminA.plainPassword);
    const res = await request(app).get(BASE).set('Authorization', `Bearer ${token}`).query({ limit: 500 });

    expect(res.status).toBe(200);
    const names = res.body.data.map((r) => r.user?.fullName || r.fullName);
    expect(names).toContain('Alice From A');
    expect(names).not.toContain('Bob From B');
  });

  it('rejects a resident from listing all residents', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const res = await request(app).get(BASE).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('is not filtered by status by default (includes INACTIVE residents)', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    await createResident(community.id, { fullName: 'Active One', status: 'ACTIVE' });
    await createResident(community.id, { fullName: 'Inactive One', status: 'INACTIVE' });
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app).get(BASE).set('Authorization', `Bearer ${token}`).query({ limit: 500 });
    const names = res.body.data.map((r) => r.user?.fullName || r.fullName);
    expect(names).toEqual(expect.arrayContaining(['Active One', 'Inactive One']));
  });
});

describe('GET /residents/:id', () => {
  it('404s for a resident id that belongs to a different community', async () => {
    const { community: communityA, admin: adminA } = await createCommunityWithAdmin();
    const { community: communityB } = await createCommunityWithAdmin();
    const { resident: residentB } = await createResident(communityB.id);

    const { token } = await loginAs(adminA.email, adminA.plainPassword);
    const res = await request(app).get(`${BASE}/${residentB.id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /residents/me (self-service update)', () => {
  it('lets a resident update their own address', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user, resident } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const res = await request(app)
      .patch('/api/v1/residents/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ address: '123 New Address' });

    expect(res.status).toBe(200);
    expect(res.body.data.address).toBe('123 New Address');

    const updated = await prisma.resident.findUnique({ where: { id: resident.id } });
    expect(updated.address).toBe('123 New Address');
  });

  // Security regression test: phone was previously editable through this
  // same plain PATCH with no verification at all — a resident could just
  // call the API directly and change the phone number used for phone
  // login (see authController.login) without ever proving they own the
  // new number. Phone changes now must go through the email-verified OTP
  // flow (userController.requestProfileOtp / verifyPhoneOtp) instead —
  // this endpoint must silently ignore `phone` in the body rather than
  // applying it.
  it('does NOT change the phone number even if one is sent in the body', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user, resident } = await createResident(community.id, { password: 'ResidentPass1', phone: '0911111111' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const res = await request(app)
      .patch('/api/v1/residents/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '0922222222', address: 'Somewhere' });

    expect(res.status).toBe(200);

    const updated = await prisma.resident.findUnique({ where: { id: resident.id } });
    expect(updated.phone).toBe('0911111111');
  });

  it('rejects an admin calling the resident-only /me endpoint', async () => {
    const { admin } = await createCommunityWithAdmin();
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app).patch('/api/v1/residents/me').set('Authorization', `Bearer ${token}`).send({ address: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /residents/:id', () => {
  it('deletes a resident and cascades to their payments', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    const { resident } = await createResident(community.id);
    await prisma.payment.create({
      data: { communityId: community.id, residentId: resident.id, amount: 50, paymentMethod: 'CASH', status: 'VERIFIED', paidAt: new Date() },
    });
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app).delete(`${BASE}/${resident.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const gone = await prisma.resident.findUnique({ where: { id: resident.id } });
    expect(gone).toBeNull();
    const paymentsLeft = await prisma.payment.count({ where: { residentId: resident.id } });
    expect(paymentsLeft).toBe(0);
  });

  it('refuses to delete a resident who is also a committee member', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    // The admin's own User has a Resident row too in the real signup flow;
    // simulate that here directly.
    const adminResident = await prisma.resident.create({
      data: { userId: admin.id, communityId: community.id, unitNumber: 'ADMIN-1', status: 'ACTIVE' },
    });
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app).delete(`${BASE}/${adminResident.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(422);
  });

  it('404s when trying to delete a resident from another community', async () => {
    const { admin: adminA } = await createCommunityWithAdmin();
    const { community: communityB } = await createCommunityWithAdmin();
    const { resident: residentB } = await createResident(communityB.id);
    const { token } = await loginAs(adminA.email, adminA.plainPassword);

    const res = await request(app).delete(`${BASE}/${residentB.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);

    const stillThere = await prisma.resident.findUnique({ where: { id: residentB.id } });
    expect(stillThere).not.toBeNull();
  });
});
