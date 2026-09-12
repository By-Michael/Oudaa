const request = require('supertest');
const app = require('../src/app');
const { prisma, resetDb, disconnectDb } = require('./testDb');
const { createCommunityWithAdmin, createResident, createFee, loginAs } = require('./factories');

const BASE = '/api/v1/fees';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
});

describe('POST /fees', () => {
  it('lets an admin create a fee', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Monthly Security Fee', amount: 250, frequency: 'MONTHLY' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Monthly Security Fee');

    const dbFee = await prisma.fee.findFirst({ where: { communityId: community.id } });
    expect(dbFee).not.toBeNull();
    expect(Number(dbFee.amount)).toBe(250);
  });

  it('rejects a resident creating a fee', async () => {
    const { community } = await createCommunityWithAdmin();
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const res = await request(app).post(BASE).set('Authorization', `Bearer ${token}`).send({ name: 'x', amount: 10 });
    expect(res.status).toBe(403);
  });

  it.each([
    ['missing name', { amount: 100 }],
    ['negative amount', { name: 'x', amount: -5 }],
    ['missing amount', { name: 'x' }],
  ])('rejects invalid input: %s', async (_label, payload) => {
    const { admin } = await createCommunityWithAdmin();
    const { token } = await loginAs(admin.email, admin.plainPassword);
    const res = await request(app).post(BASE).set('Authorization', `Bearer ${token}`).send(payload);
    expect(res.status).toBe(400);
  });
});

describe('GET /fees', () => {
  it('both admins and residents can list fees, scoped to their own community', async () => {
    const { community: communityA, admin: adminA } = await createCommunityWithAdmin();
    const { community: communityB } = await createCommunityWithAdmin();
    await createFee(communityA.id, { name: 'Fee A' });
    await createFee(communityB.id, { name: 'Fee B' });
    const { user: residentA } = await createResident(communityA.id, { password: 'ResidentPass1' });

    const { token: adminToken } = await loginAs(adminA.email, adminA.plainPassword);
    const adminRes = await request(app).get(BASE).set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
    const adminNames = adminRes.body.data.map((f) => f.name);
    expect(adminNames).toContain('Fee A');
    expect(adminNames).not.toContain('Fee B');

    const { token: residentToken } = await loginAs(residentA.email, 'ResidentPass1');
    const residentRes = await request(app).get(BASE).set('Authorization', `Bearer ${residentToken}`);
    expect(residentRes.status).toBe(200);
    expect(residentRes.body.data.map((f) => f.name)).toContain('Fee A');
  });
});

describe('PATCH /fees/:id', () => {
  it('updates a fee belonging to the admin\'s community', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    const fee = await createFee(community.id, { name: 'Old Name' });
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app)
      .patch(`${BASE}/${fee.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('New Name');
  });

  it('404s when updating a fee from a different community', async () => {
    const { admin: adminA } = await createCommunityWithAdmin();
    const { community: communityB } = await createCommunityWithAdmin();
    const feeB = await createFee(communityB.id);
    const { token } = await loginAs(adminA.email, adminA.plainPassword);

    const res = await request(app).patch(`${BASE}/${feeB.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Hijacked' });
    expect(res.status).toBe(404);

    const stillOriginal = await prisma.fee.findUnique({ where: { id: feeB.id } });
    expect(stillOriginal.name).not.toBe('Hijacked');
  });
});

describe('DELETE /fees/:id', () => {
  it('deletes a fee in the admin\'s own community', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    const fee = await createFee(community.id);
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app).delete(`${BASE}/${fee.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const gone = await prisma.fee.findUnique({ where: { id: fee.id } });
    expect(gone).toBeNull();
  });

  it('404s deleting a fee from a different community, and does not delete it', async () => {
    const { admin: adminA } = await createCommunityWithAdmin();
    const { community: communityB } = await createCommunityWithAdmin();
    const feeB = await createFee(communityB.id);
    const { token } = await loginAs(adminA.email, adminA.plainPassword);

    const res = await request(app).delete(`${BASE}/${feeB.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);

    const stillThere = await prisma.fee.findUnique({ where: { id: feeB.id } });
    expect(stillThere).not.toBeNull();
  });
});
