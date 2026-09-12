# Backend tests

## What's here

- `env.setup.js` — loads `.env.test` before anything else runs (Jest `setupFiles`).
- `testDb.js` — `resetDb()` truncates every table between tests, so each test starts clean.
- `factories.js` — helpers for creating test data (`createCommunityWithAdmin`,
  `createResident`, `createFee`, `createFund`, `createProject`, `createPayment`,
  `loginAs`).
- `auth.test.js` — integration tests for `/api/v1/auth/*`.
- `residents.test.js` — resident CRUD, role/community scoping, and a
  regression test locking in that `PATCH /residents/me` can never change
  `phone` (that must go through the OTP flow — see `profileOtp.test.js`).
- `fees.test.js` — fee CRUD and community scoping.
- `payments.test.js` — admin-recorded payments, resident-submitted
  self-verify (bank-verification stub mode, duplicate txnId handling,
  underpayment rejection).
- `tenantIsolation.test.js` — dedicated cross-community leak tests spanning
  residents, fees, funds, projects, and payments in one place, so a
  `tenantScope`/`where` regression anywhere shows up here even if the
  resource's own test file doesn't happen to catch it.
- `authorize.unit.test.js` — pure unit tests of the `authorize` middleware
  directly (no DB, no HTTP — fastest tests in the suite).
- `profileOtp.test.js` — the email-verified OTP flow for phone/avatar
  changes (request/verify, expiry, single-use, attempt lockout, cross-user
  code isolation).

## One-time setup

1. **Create a database that is NOT your production Supabase project.**
   Easiest: create a second, free Supabase project just for testing.
2. Copy the env template:
   ```
   cp .env.test.example .env.test
   ```
3. Edit `.env.test` and set `DATABASE_URL` to that test database's connection string.
4. Push the schema to it (creates the tables, doesn't touch your real DB):
   ```
   npx dotenv -e .env.test -- npx prisma migrate deploy
   ```
   (If you don't have `dotenv-cli`: `npm i -D dotenv-cli`, or just run
   `DATABASE_URL="<paste test url>" npx prisma migrate deploy` instead.)

## Running the tests

```
npm test
```

This runs Jest serially (`--runInBand`) against the routes in `src/app.js`,
using Supertest to fire real HTTP requests without starting a live server.

## How a test in this file works, line by line

```js
const res = await request(app).post('/api/v1/auth/login').send({ identifier, password });
expect(res.status).toBe(200);
```

- `request(app)` — Supertest wraps your Express app so it can send it fake
  HTTP requests in-memory (fast, no real port needed).
- `.post(url).send(body)` — builds and sends the request.
- `expect(res.status).toBe(200)` — Jest's assertion: fail the test loudly if
  this isn't true.

`beforeEach(async () => { await resetDb(); })` runs before every single
`it(...)` in the file, wiping all tables — so test order never matters and
one test's leftover data can never leak into another.

## Adding your own test file

Copy the shape of `auth.test.js`:

```js
const request = require('supertest');
const app = require('../src/app');
const { resetDb, disconnectDb } = require('./testDb');
const { createCommunityWithAdmin } = require('./factories');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await disconnectDb(); });

describe('POST /api/v1/residents', () => {
  it('creates a resident when authenticated as an admin', async () => {
    // ...
  });
});
```

Good next targets, roughly in order of value: expenses, projects (including
cancellation and pending-change approval flows), committee transfer
requests, and the support-chat rate limiter.
