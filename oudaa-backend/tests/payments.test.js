const request = require('supertest');
const app = require('../src/app');
const { prisma, resetDb, disconnectDb } = require('./testDb');
const { createCommunityWithAdmin, createResident, createFee, createFund, loginAs } = require('./factories');

const BASE = '/api/v1/payments';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
});

describe('POST /payments (admin recording on behalf of a resident)', () => {
  it('records a payment as VERIFIED immediately', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    const fee = await createFee(community.id, { amount: 300 });
    const { resident } = await createResident(community.id);
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ residentId: resident.id, feeId: fee.id, amount: 300, paymentMethod: 'CASH' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('VERIFIED');
    expect(res.body.data.verifiedBy).toBe(admin.id);
  });

  it('404s when residentId belongs to a different community', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    const fee = await createFee(community.id);
    const { community: communityB } = await createCommunityWithAdmin();
    const { resident: residentB } = await createResident(communityB.id);
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ residentId: residentB.id, feeId: fee.id, amount: 100, paymentMethod: 'CASH' });

    expect(res.status).toBe(404);
  });

  it('rejects a request with more than one of feeId/projectId/fundId', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    const fee = await createFee(community.id);
    const fund = await createFund(community.id);
    const { resident } = await createResident(community.id);
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ residentId: resident.id, feeId: fee.id, fundId: fund.id, amount: 100 });

    expect(res.status).toBe(400);
  });

  it('a resident hitting POST /payments records for themself, but stays PENDING (not auto-VERIFIED)', async () => {
    const { community } = await createCommunityWithAdmin();
    const fee = await createFee(community.id);
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ feeId: fee.id, amount: Number(fee.amount), paymentMethod: 'CASH' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
  });
});

describe('GET /payments', () => {
  it('a resident only ever sees their own payments, never another resident\'s', async () => {
    const { community } = await createCommunityWithAdmin();
    const fee = await createFee(community.id, { amount: 50 });
    const { user: userA, resident: residentA } = await createResident(community.id, { password: 'ResidentPass1' });
    const { resident: residentB } = await createResident(community.id, { password: 'ResidentPass2' });

    await prisma.payment.create({ data: { communityId: community.id, residentId: residentA.id, feeId: fee.id, amount: 50, paymentMethod: 'CASH', status: 'VERIFIED', paidAt: new Date() } });
    await prisma.payment.create({ data: { communityId: community.id, residentId: residentB.id, feeId: fee.id, amount: 50, paymentMethod: 'CASH', status: 'VERIFIED', paidAt: new Date() } });

    const { token } = await loginAs(userA.email, 'ResidentPass1');
    const res = await request(app).get(BASE).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((p) => p.residentId === residentA.id)).toBe(true);
  });

  it('an admin sees every payment in their own community only', async () => {
    const { community: communityA, admin: adminA } = await createCommunityWithAdmin();
    const { community: communityB } = await createCommunityWithAdmin();
    const { resident: residentA } = await createResident(communityA.id);
    const { resident: residentB } = await createResident(communityB.id);
    const fundA = await createFund(communityA.id);
    const fundB = await createFund(communityB.id);

    await prisma.payment.create({ data: { communityId: communityA.id, residentId: residentA.id, amount: 10, paymentMethod: 'CASH', status: 'VERIFIED', paidAt: new Date(), fundId: fundA.id } });
    await prisma.payment.create({ data: { communityId: communityB.id, residentId: residentB.id, amount: 10, paymentMethod: 'CASH', status: 'VERIFIED', paidAt: new Date(), fundId: fundB.id } });

    const { token } = await loginAs(adminA.email, adminA.plainPassword);
    const res = await request(app).get(BASE).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((p) => p.communityId === communityA.id)).toBe(true);
  });
});

describe('POST /payments/self-verify', () => {
  it('rejects a non-resident (admin) from self-verifying', async () => {
    const { community, admin } = await createCommunityWithAdmin();
    const fee = await createFee(community.id);
    const { token } = await loginAs(admin.email, admin.plainPassword);

    const res = await request(app)
      .post(`${BASE}/self-verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ feeId: fee.id, payerName: 'Someone', txnId: 'ABC123456', provider: 'telebirr', phoneNumber: '0911111111' });

    expect(res.status).toBe(403);
  });

  // No VERITAS_API_KEY is set in the test environment (see env.setup.js /
  // .env.test), so bankVerification.js runs in STUB mode, which always
  // returns fieldsIncomplete: true — meaning even a "matched" stub result
  // can never auto-VERIFY, only ever land in PENDING_REVIEW (see the
  // safeguard-layer comment in paymentController.js). This test locks in
  // that behavior — a bug that made stub mode auto-approve would be a
  // real, dangerous regression (unverified money marked VERIFIED).
  it('a plausible-looking txnId lands in PENDING_REVIEW, never auto-VERIFIED, in stub mode', async () => {
    const { community } = await createCommunityWithAdmin();
    const fee = await createFee(community.id, { amount: 100 });
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const res = await request(app)
      .post(`${BASE}/self-verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ feeId: fee.id, payerName: 'Test Resident', txnId: 'TXN123456', provider: 'telebirr', phoneNumber: '0911111111' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PENDING_REVIEW');
  });

  it('rejects an ID the stub recognizes as invalid, with 422', async () => {
    const { community } = await createCommunityWithAdmin();
    const fee = await createFee(community.id);
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const res = await request(app)
      .post(`${BASE}/self-verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ feeId: fee.id, payerName: 'Test Resident', txnId: 'INVALID', provider: 'telebirr', phoneNumber: '0911111111' });

    expect(res.status).toBe(422);
  });

  it('rejects reusing a txnId a different resident already used, with 409', async () => {
    const { community } = await createCommunityWithAdmin();
    const fee = await createFee(community.id, { amount: 100 });
    const { user: user1 } = await createResident(community.id, { password: 'ResidentPass1' });
    const { user: user2 } = await createResident(community.id, { password: 'ResidentPass2' });

    const { token: token1 } = await loginAs(user1.email, 'ResidentPass1');
    const first = await request(app)
      .post(`${BASE}/self-verify`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ feeId: fee.id, payerName: 'Resident One', txnId: 'SHAREDTXN1', provider: 'telebirr', phoneNumber: '0911111111' });
    expect(first.status).toBe(200);

    const { token: token2 } = await loginAs(user2.email, 'ResidentPass2');
    const second = await request(app)
      .post(`${BASE}/self-verify`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ feeId: fee.id, payerName: 'Resident Two', txnId: 'SHAREDTXN1', provider: 'telebirr', phoneNumber: '0922222222' });

    expect(second.status).toBe(409);
  });

  it('the SAME resident resubmitting their own txnId gets the existing payment back (idempotent), not an error', async () => {
    const { community } = await createCommunityWithAdmin();
    const fee = await createFee(community.id, { amount: 100 });
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const payload = { feeId: fee.id, payerName: 'Test Resident', txnId: 'IDEMPOTENT1', provider: 'telebirr', phoneNumber: '0911111111' };
    const first = await request(app).post(`${BASE}/self-verify`).set('Authorization', `Bearer ${token}`).send(payload);
    expect(first.status).toBe(200);

    const second = await request(app).post(`${BASE}/self-verify`).set('Authorization', `Bearer ${token}`).send(payload);
    expect(second.status).toBe(200);
    expect(second.body.idempotentReplay).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('rejects an underpayment against the fee amount', async () => {
    const { community } = await createCommunityWithAdmin();
    const fee = await createFee(community.id, { amount: 500 });
    const { user } = await createResident(community.id, { password: 'ResidentPass1' });
    const { token } = await loginAs(user.email, 'ResidentPass1');

    const res = await request(app)
      .post(`${BASE}/self-verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ feeId: fee.id, payerName: 'Test Resident', txnId: 'UNDERPAY1', provider: 'telebirr', phoneNumber: '0911111111', amount: 100 });

    expect(res.status).toBe(422);
  });
});
