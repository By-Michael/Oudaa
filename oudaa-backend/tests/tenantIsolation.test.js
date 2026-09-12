// Dedicated multi-tenancy tests. Every controller elsewhere is tested for
// its own behavior; this file exists purely to hammer on one thing across
// every resource type: a user authenticated as community A must NEVER be
// able to read, modify, or delete community B's data, however the id gets
// there (URL param, body field, or a resource nested under another one).
//
// If tenantScope.js or a controller's `where` clause ever regresses to
// missing a communityId filter, this file is where it should get caught.

const request = require('supertest');
const app = require('../src/app');
const { prisma, resetDb, disconnectDb } = require('./testDb');
const { createCommunityWithAdmin, createResident, createFee, createFund, loginAs } = require('./factories');

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
});

// Sets up two fully independent communities, each with an admin and a
// resident, so every test below can try to reach across from A into B.
async function twoCommunities() {
  const a = await createCommunityWithAdmin();
  const b = await createCommunityWithAdmin();
  const residentA = await createResident(a.community.id, { password: 'ResidentPassA1' });
  const residentB = await createResident(b.community.id, { password: 'ResidentPassB1' });
  return { a, b, residentA, residentB };
}

describe('cross-community isolation', () => {
  it('an admin cannot GET a resident belonging to another community', async () => {
    const { a, residentB } = await twoCommunities();
    const { token } = await loginAs(a.admin.email, a.admin.plainPassword);

    const res = await request(app).get(`/api/v1/residents/${residentB.resident.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('an admin cannot PATCH a fee belonging to another community', async () => {
    const { a, b } = await twoCommunities();
    const feeB = await createFee(b.community.id, { amount: 10 });
    const { token } = await loginAs(a.admin.email, a.admin.plainPassword);

    const res = await request(app)
      .patch(`/api/v1/fees/${feeB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 99999 });
    expect(res.status).toBe(404);
  });

  it('an admin cannot DELETE a fund belonging to another community', async () => {
    const { a, b } = await twoCommunities();
    const fundB = await createFund(b.community.id);
    const { token } = await loginAs(a.admin.email, a.admin.plainPassword);

    const res = await request(app).delete(`/api/v1/funds/${fundB.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('an admin cannot create a project on a fund belonging to another community', async () => {
    const { a, b } = await twoCommunities();
    const fundB = await createFund(b.community.id);
    const { token } = await loginAs(a.admin.email, a.admin.plainPassword);

    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cross-tenant project', budget: 1000, fundId: fundB.id, startDate: new Date().toISOString() });

    // Whatever status this ends up being (404 for "fund not found in your
    // community" is expected), it must NOT succeed (2xx).
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('a resident cannot GET another community\'s fund summaries', async () => {
    const { a, residentA } = await twoCommunities();
    const { b } = await twoCommunities();
    await createFund(b.community.id, { name: 'Community B Fund' });
    const { token } = await loginAs(residentA.user.email, 'ResidentPassA1');

    const res = await request(app).get('/api/v1/funds/summaries').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((f) => f.name !== 'Community B Fund')).toBe(true);
  });

  it('an admin token from community A always resolves "my community" to A, never to B', async () => {
    const { a, b } = await twoCommunities();
    const { token } = await loginAs(a.admin.email, a.admin.plainPassword);

    const res = await request(app).get('/api/v1/communities/me/current').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(a.community.id);
    expect(res.body.data.id).not.toBe(b.community.id);
  });

  it('a resident\'s JWT cannot be used to hit an admin-only route even for their own community', async () => {
    const { a, residentA } = await twoCommunities();
    const { token } = await loginAs(residentA.user.email, 'ResidentPassA1');

    const res = await request(app)
      .post('/api/v1/fees')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sneaky Fee', amount: 1 });

    expect(res.status).toBe(403);
  });

  it('deactivating a resident in community A has no effect on an identically-shaped resident in community B', async () => {
    const { a, b, residentA, residentB } = await twoCommunities();
    const { token } = await loginAs(a.admin.email, a.admin.plainPassword);

    const res = await request(app)
      .post(`/api/v1/residents/${residentA.resident.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Moved out' });
    expect(res.status).toBe(200);

    const untouched = await prisma.resident.findUnique({ where: { id: residentB.resident.id } });
    expect(untouched.status).toBe('ACTIVE');
  });
});
