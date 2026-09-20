const request = require('supertest');
const app = require('../../src/app');

describe('Platform admin CORS', () => {
  it('allows the deployed Free-tier admin origin and handles preflight', async () => {
    const res = await request(app)
      .options('/api/platform/v1/auth/login')
      .set('Origin', 'https://oudaa-platform-admin.onrender.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    // In tests the common CORS env may be set to localhost, but the deployed
    // origin is intentionally always retained by the platform-admin policy.
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://oudaa-platform-admin.onrender.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
