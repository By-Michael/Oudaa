jest.mock('../../src/config/prisma', () => ({
  $queryRaw: jest.fn(),
}));

describe('platformHealthService.getSystemStatus', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SENDER_EMAIL;
    delete process.env.VERITAS_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OCRSPACE_API_KEY;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // Re-requires prisma fresh EVERY test (after resetModules) rather than
  // capturing one reference at file scope, since resetModules() gives
  // platformHealthService's own internal require() a brand-new mock
  // instance each time — capturing the mock once at the top would
  // silently drift out of sync with the instance the service actually
  // calls.
  function load() {
    // eslint-disable-next-line global-require
    const prisma = require('../../src/config/prisma');
    // eslint-disable-next-line global-require
    const { getSystemStatus } = require('../../src/services/platformAdmin/platformHealthService');
    return { prisma, getSystemStatus };
  }

  it('reports NOT_CONFIGURED for every optional dependency when no env vars are set', async () => {
    const { prisma, getSystemStatus } = load();
    prisma.$queryRaw.mockResolvedValue([{}]);
    const status = await getSystemStatus();

    expect(status.api.status).toBe('HEALTHY');
    expect(status.storage.status).toBe('NOT_CONFIGURED');
    expect(status.email.status).toBe('NOT_CONFIGURED');
    expect(status.paymentVerification.status).toBe('NOT_CONFIGURED');
    expect(status.aiSupport.status).toBe('NOT_CONFIGURED');
  });

  it('reports database UNAVAILABLE when the query throws', async () => {
    const { prisma, getSystemStatus } = load();
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const status = await getSystemStatus();
    expect(status.database.status).toBe('UNAVAILABLE');
    expect(status.database.error).toContain('connection refused');
  });

  it('reports database HEALTHY on a fast successful query', async () => {
    const { prisma, getSystemStatus } = load();
    prisma.$queryRaw.mockResolvedValue([{}]);
    const status = await getSystemStatus();
    expect(status.database.status).toBe('HEALTHY');
    expect(typeof status.database.latencyMs).toBe('number');
  });

  it('reports email HEALTHY once BREVO credentials are set', async () => {
    process.env.BREVO_API_KEY = 'key';
    process.env.BREVO_SENDER_EMAIL = 'noreply@hivee.test';
    const { prisma, getSystemStatus } = load();
    prisma.$queryRaw.mockResolvedValue([{}]);
    const status = await getSystemStatus();
    expect(status.email.status).toBe('HEALTHY');
  });

  it('never reports HEALTHY for a dependency with no configuration signal at all (never fabricates)', async () => {
    const { prisma, getSystemStatus } = load();
    prisma.$queryRaw.mockResolvedValue([{}]);
    const status = await getSystemStatus();
    for (const key of ['storage', 'email', 'paymentVerification', 'aiSupport']) {
      expect(status[key].status).not.toBe('HEALTHY');
    }
  });
});
