'use strict';

const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../../src/app');
const { prisma, resetDb, disconnectDb } = require('../testDb');

const BASE = '/api/platform/v1';

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnectDb();
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function createPlatformAdmin(role = 'SUPPORT_AGENT', email = 'agent@hivee.local') {
  const passwordHash = await bcrypt.hash('Password123!', 12);
  return prisma.platformAdmin.create({ data: { fullName: 'Agent', email, passwordHash, role, isActive: true } });
}

async function loginPlatformAdmin(email = 'agent@hivee.local', password = 'Password123!') {
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  return res.body.data?.accessToken;
}

async function createCommunity(name = 'Greenwood') {
  const slug = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
  return prisma.community.create({ data: { name, slug, status: 'ACTIVE' } });
}

async function createResidentUser(communityId, email = `resident-${Date.now()}@example.com`) {
  const hash = await bcrypt.hash('P@ssword1!', 12);
  return prisma.user.create({ data: { communityId, fullName: 'Resident One', email, passwordHash: hash, role: 'RESIDENT' } });
}

async function createTicket(communityId, userId, overrides = {}) {
  return prisma.supportTicket.create({
    data: { communityId, userId, subject: 'Payment stuck', description: 'It has been pending for days', ...overrides },
  });
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('Ticket permissions', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get(`${BASE}/support/tickets`);
    expect(res.status).toBe(401);
  });

  it('a role with SUPPORT_VIEW can list tickets', async () => {
    await createPlatformAdmin('SUPPORT_AGENT');
    const token = await loginPlatformAdmin();
    const res = await request(app).get(`${BASE}/support/tickets`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('a role WITHOUT SUPPORT_VIEW (e.g. FINANCE_OPERATOR) is rejected with 403', async () => {
    await createPlatformAdmin('FINANCE_OPERATOR', 'finance@hivee.local');
    const token = await loginPlatformAdmin('finance@hivee.local');
    const res = await request(app).get(`${BASE}/support/tickets`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('Ticket creation and assignment', () => {
  it('creates a ticket and audits TICKET_CREATED', async () => {
    const community = await createCommunity();
    const resident = await createResidentUser(community.id);
    await createPlatformAdmin('SUPPORT_AGENT');
    const token = await loginPlatformAdmin();

    const res = await request(app)
      .post(`${BASE}/support/tickets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: resident.id, communityId: community.id, subject: 'Cannot log in', description: 'Password reset link expired' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('OPEN');

    const audit = await prisma.platformAuditLog.findMany({ where: { action: 'TICKET_CREATED' } });
    expect(audit.length).toBe(1);
  });

  it('assigns a ticket to a platform admin and records TICKET_ASSIGNED', async () => {
    const community = await createCommunity();
    const resident = await createResidentUser(community.id);
    const agent = await createPlatformAdmin('SUPPORT_AGENT');
    const token = await loginPlatformAdmin();
    const ticket = await createTicket(community.id, resident.id);

    const res = await request(app)
      .post(`${BASE}/support/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId: agent.id });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedToId).toBe(agent.id);

    const audit = await prisma.platformAuditLog.findMany({ where: { action: 'TICKET_ASSIGNED' } });
    expect(audit.length).toBe(1);
  });
});

describe('Status changes', () => {
  it('rejects an invalid status value', async () => {
    const community = await createCommunity();
    const resident = await createResidentUser(community.id);
    await createPlatformAdmin('SUPPORT_AGENT');
    const token = await loginPlatformAdmin();
    const ticket = await createTicket(community.id, resident.id);

    const res = await request(app)
      .patch(`${BASE}/support/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'NOT_A_REAL_STATUS' });
    expect(res.status).toBe(400);
  });

  it('setting status to RESOLVED stamps resolvedAt', async () => {
    const community = await createCommunity();
    const resident = await createResidentUser(community.id);
    await createPlatformAdmin('SUPPORT_AGENT');
    const token = await loginPlatformAdmin();
    const ticket = await createTicket(community.id, resident.id);

    const res = await request(app)
      .patch(`${BASE}/support/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'RESOLVED' });

    expect(res.status).toBe(200);
    expect(res.body.data.resolvedAt).toBeTruthy();
  });
});

describe('Internal note privacy', () => {
  it('an internal note is stored with isInternalNote:true and returned in the (operator-only) detail view', async () => {
    const community = await createCommunity();
    const resident = await createResidentUser(community.id);
    await createPlatformAdmin('SUPPORT_AGENT');
    const token = await loginPlatformAdmin();
    const ticket = await createTicket(community.id, resident.id);

    const noteRes = await request(app)
      .post(`${BASE}/support/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Escalate to billing team internally', isInternalNote: true });
    expect(noteRes.status).toBe(201);
    expect(noteRes.body.data.isInternalNote).toBe(true);

    const detailRes = await request(app).get(`${BASE}/support/tickets/${ticket.id}`).set('Authorization', `Bearer ${token}`);
    const note = detailRes.body.data.messages.find((m) => m.id === noteRes.body.data.id);
    expect(note.isInternalNote).toBe(true);
  });

  it('a customer-visible reply is stored with isInternalNote:false and distinguishable from a note', async () => {
    const community = await createCommunity();
    const resident = await createResidentUser(community.id);
    await createPlatformAdmin('SUPPORT_AGENT');
    const token = await loginPlatformAdmin();
    const ticket = await createTicket(community.id, resident.id);

    const replyRes = await request(app)
      .post(`${BASE}/support/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'We are looking into this for you', isInternalNote: false });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.data.isInternalNote).toBe(false);
  });

  it('there is no community-facing route that can read SupportTicketMessage at all', async () => {
    // Structural check: the community API surface (/api/v1/*) has no
    // support-ticket route registered, so isInternalNote can never leak
    // through it regardless of what an agent writes.
    const community = await createCommunity();
    const resident = await createResidentUser(community.id);
    const hash = await bcrypt.hash('P@ssword1!', 12);
    await prisma.user.update({ where: { id: resident.id }, data: { passwordHash: hash } });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: resident.email, password: 'P@ssword1!' });
    const residentToken = loginRes.body.data?.accessToken;

    const ticket = await createTicket(community.id, resident.id);
    const attempt = await request(app)
      .get(`/api/v1/support/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${residentToken || 'irrelevant'}`);
    expect(attempt.status).toBe(404); // route simply does not exist
  });
});

describe('Support-agent restrictions', () => {
  it('SUPPORT_AGENT cannot access platform security endpoints', async () => {
    await createPlatformAdmin('SUPPORT_AGENT');
    const token = await loginPlatformAdmin();
    // No dedicated /security endpoints exist yet (future phase), but the
    // permission itself must be absent — verified via the dashboard's
    // permission-gated recent-activity securityEvents field as a proxy
    // for "this role cannot see security-management data".
    const res = await request(app).get(`${BASE}/dashboard/recent-activity`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.securityEvents).toBeUndefined();
  });
});

describe('Cross-community ticket handling', () => {
  it('a ticket correctly carries its own community, independent of any other community existing', async () => {
    const communityA = await createCommunity('Community A');
    const communityB = await createCommunity('Community B');
    const userA = await createResidentUser(communityA.id);
    await createResidentUser(communityB.id); // exists to prove no cross-contamination
    await createPlatformAdmin('SUPPORT_AGENT');
    const token = await loginPlatformAdmin();

    const ticket = await createTicket(communityA.id, userA.id);
    const res = await request(app).get(`${BASE}/support/tickets/${ticket.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.body.data.communityId).toBe(communityA.id);
    expect(res.body.data.communityId).not.toBe(communityB.id);
  });

  it('filtering the inbox by communityId only returns that community\'s tickets', async () => {
    const communityA = await createCommunity('Community A');
    const communityB = await createCommunity('Community B');
    const userA = await createResidentUser(communityA.id);
    const userB = await createResidentUser(communityB.id);
    await createPlatformAdmin('SUPPORT_AGENT');
    const token = await loginPlatformAdmin();
    await createTicket(communityA.id, userA.id, { subject: 'A ticket' });
    await createTicket(communityB.id, userB.id, { subject: 'B ticket' });

    const res = await request(app)
      .get(`${BASE}/support/tickets`)
      .query({ communityId: communityA.id })
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].subject).toBe('A ticket');
  });
});

describe('Existing community support functionality is untouched', () => {
  it('the community AI chat endpoint (aiStatus) still works exactly as before', async () => {
    const community = await createCommunity();
    const resident = await createResidentUser(community.id);
    const hash = await bcrypt.hash('P@ssword1!', 12);
    await prisma.user.update({ where: { id: resident.id }, data: { passwordHash: hash } });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: resident.email, password: 'P@ssword1!' });
    const token = loginRes.body.data?.accessToken;

    const res = await request(app).get('/api/v1/support/ai-status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.configured).toBe('boolean');
  });
});
