const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('./testDb');
const { phoneSearchKeyFor } = require('../src/utils/phone');
const { generateUniqueSlug } = require('../src/utils/slugify');

let counter = 0;
function unique(label) {
  counter += 1;
  return `${label}-${Date.now()}-${counter}`;
}

/**
 * Creates a Community + an ADMIN User belonging to it, with a known
 * plaintext password (so tests can log in with it).
 */
async function createCommunityWithAdmin({ password = 'Password123!' } = {}) {
  const name = unique('Test Community');
  const slug = await generateUniqueSlug(name);
  const community = await prisma.community.create({
    data: { name, slug },
  });

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.create({
    data: {
      communityId: community.id,
      fullName: 'Test Admin',
      email: `${unique('admin')}@example.com`,
      passwordHash,
      role: 'ADMIN',
    },
  });

  return { community, admin: { ...admin, plainPassword: password } };
}

/**
 * Creates a RESIDENT User + Resident row in the given community, with a
 * known plaintext password. Mirrors the fields residentController.
 * createResident sets on a normal signup, including phoneSearchKey (kept
 * in sync with `phone` — see utils/phone.js) so phone-login tests work
 * against factory-created residents the same way they would against a
 * resident created through the real API.
 */
async function createResident(communityId, { password = 'Password123!', fullName = 'Test Resident', unitNumber, phone, status = 'ACTIVE' } = {}) {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      communityId,
      fullName,
      email: `${unique('resident')}@example.com`,
      passwordHash,
      role: 'RESIDENT',
    },
  });

  const resident = await prisma.resident.create({
    data: {
      userId: user.id,
      communityId,
      unitNumber: unitNumber || unique('unit'),
      phone: phone || undefined,
      phoneSearchKey: phone ? phoneSearchKeyFor(phone) : undefined,
      status,
    },
  });

  return { user: { ...user, plainPassword: password }, resident };
}

async function createFee(communityId, overrides = {}) {
  return prisma.fee.create({
    data: {
      communityId,
      name: unique('Fee'),
      amount: 100,
      frequency: 'MONTHLY',
      ...overrides,
    },
  });
}

async function createFund(communityId, overrides = {}) {
  return prisma.fund.create({
    data: {
      communityId,
      name: unique('Fund'),
      ...overrides,
    },
  });
}

async function createProject(communityId, fundId, overrides = {}) {
  return prisma.project.create({
    data: {
      communityId,
      fundId,
      name: unique('Project'),
      budget: 10000,
      status: 'ONGOING',
      startDate: new Date(),
      ...overrides,
    },
  });
}

async function createPayment(communityId, residentId, overrides = {}) {
  return prisma.payment.create({
    data: {
      communityId,
      residentId,
      amount: 100,
      paymentMethod: 'CASH',
      status: 'VERIFIED',
      paidAt: new Date(),
      ...overrides,
    },
  });
}

/**
 * Logs in as the given user (email + plaintext password) via the real
 * /auth/login endpoint, the same way the app itself authenticates —
 * rather than minting a JWT by hand, so tests also exercise the actual
 * login path's behavior (e.g. would correctly fail for a deactivated
 * resident, wrong community's login page, etc. if extended to check
 * that). Returns both the bearer token (for `.set('Authorization', ...)`)
 * and a cookie-persisting Supertest agent (for flows that need the
 * refresh-token cookie, e.g. testing /auth/refresh afterwards).
 */
async function loginAs(identifier, password, communitySlug) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ identifier, password, communitySlug });
  if (res.status !== 200) {
    throw new Error(`loginAs(${identifier}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.data.accessToken, user: res.body.data.user, agent };
}

module.exports = {
  unique,
  createCommunityWithAdmin,
  createResident,
  createFee,
  createFund,
  createProject,
  createPayment,
  loginAs,
};
