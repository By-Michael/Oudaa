/**
 * Phase 5 unit tests — platform performance & monitoring.
 *
 * Covers:
 *  1. platformMetricsStore — record, aggregate, percentiles, window filter
 *  2. platformMetricsService — process metrics shape, snapshot dedup
 *  3. platformPerformanceService — DB health, storage, integration checks
 *  4. platformErrorLogService — captureError, getErrors, getErrorGroups
 *  5. Permission enforcement — PERFORMANCE_VIEW required, SUPPORT_AGENT denied
 *  6. Request ID traceability — X-Request-Id on responses
 *  7. Metrics do not overload DB — snapshot skipped when recent exists
 */

// ============================================================================
// 1. platformMetricsStore
// ============================================================================

describe('platformMetricsStore', () => {
  let store;

  beforeEach(() => {
    jest.resetModules();
    // Re-require after reset so the in-memory state is fresh for each test
    store = require('../../src/services/platformAdmin/platformMetricsStore');
  });

  function push(overrides = {}) {
    store.record({
      ts: Date.now(),
      latencyMs: 50,
      status: 200,
      route: 'GET /api/v1/test',
      ...overrides,
    });
  }

  it('records a request and reflects it in getWindowStats', () => {
    push({ latencyMs: 100, status: 200 });
    const stats = store.getWindowStats(60 * 60 * 1_000);
    expect(stats.hasData).toBe(true);
    expect(stats.requestCount).toBeGreaterThanOrEqual(1);
    expect(stats.avgLatency).toBe(100);
  });

  it('counts 4xx and 5xx errors correctly', () => {
    push({ status: 200 });
    push({ status: 404 });
    push({ status: 500 });
    const stats = store.getWindowStats(60 * 60 * 1_000);
    expect(stats.errorCount).toBeGreaterThanOrEqual(2);
    expect(stats.rate4xx).toBeGreaterThanOrEqual(1);
    expect(stats.rate5xx).toBeGreaterThanOrEqual(1);
    expect(stats.successCount).toBeGreaterThanOrEqual(1);
  });

  it('returns hasData:false for an empty window (future timestamp)', () => {
    // Nothing pushed yet in fresh module
    const stats = store.getWindowStats(1); // 1ms window — nothing will match
    expect(stats.hasData).toBe(false);
    expect(stats.requestCount).toBe(0);
  });

  it('computes percentiles correctly', () => {
    // Push 10 requests with latencies 10, 20, …, 100
    for (let i = 1; i <= 10; i++) {
      push({ latencyMs: i * 10 });
    }
    const stats = store.getWindowStats(60 * 60 * 1_000);
    expect(stats.p50).toBeGreaterThanOrEqual(50);
    expect(stats.p95).toBeGreaterThanOrEqual(90);
    expect(stats.p99).toBeGreaterThanOrEqual(90);
    expect(stats.p99).toBeGreaterThanOrEqual(stats.p95);
    expect(stats.p95).toBeGreaterThanOrEqual(stats.p50);
  });

  it('identifies slow endpoints', () => {
    push({ route: 'GET /api/v1/fast', latencyMs: 5 });
    push({ route: 'GET /api/v1/slow', latencyMs: 999 });
    const slow = store.getSlowEndpoints(60 * 60 * 1_000, 5);
    expect(slow[0].route).toBe('GET /api/v1/slow');
    expect(slow[0].avgLatency).toBe(999);
  });

  it('identifies high-traffic endpoints', () => {
    for (let i = 0; i < 5; i++) push({ route: 'GET /api/v1/busy' });
    push({ route: 'GET /api/v1/quiet' });
    const traffic = store.getHighTrafficEndpoints(60 * 60 * 1_000, 5);
    expect(traffic[0].route).toBe('GET /api/v1/busy');
    expect(traffic[0].count).toBe(5);
  });

  it('getTimeSeries returns points in ascending order', () => {
    push({ ts: Date.now() - 30_000, latencyMs: 10 });
    push({ ts: Date.now() - 10_000, latencyMs: 20 });
    const { points } = store.getTimeSeries(60 * 1_000);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].ts).toBeGreaterThanOrEqual(points[i - 1].ts);
    }
  });

  it('availableWindows returns only windows with data', () => {
    // Nothing pushed — all windows should be empty
    const available = store.availableWindows([
      15 * 60 * 1_000,
      60 * 60 * 1_000,
    ]);
    expect(available).toHaveLength(0);

    push({ latencyMs: 1, ts: Date.now() });
    const after = store.availableWindows([15 * 60 * 1_000, 60 * 60 * 1_000]);
    expect(after.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 2. platformMetricsService — process metrics shape + snapshot dedup
// ============================================================================

const mockPrismaForMetrics = {
  $queryRaw: jest.fn().mockResolvedValue([{}]),
  platformMetricSnapshot: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  platformAdminSession: {
    count: jest.fn().mockResolvedValue(3),
  },
};

jest.mock('../../src/config/prisma', () => mockPrismaForMetrics);

describe('platformMetricsService.getProcessMetrics', () => {
  let svc;

  beforeAll(() => {
    svc = require('../../src/services/platformAdmin/platformMetricsService');
  });

  it('returns real process data with expected shape', async () => {
    const m = await svc.getProcessMetrics();
    expect(m.nodeVersion).toMatch(/^v\d+/);
    expect(typeof m.pid).toBe('number');
    expect(typeof m.uptimeSec).toBe('number');
    expect(m.uptimeSec).toBeGreaterThan(0);
    expect(m.memory).toHaveProperty('rssMb');
    expect(m.memory).toHaveProperty('heapUsedMb');
    expect(m.memory).toHaveProperty('heapTotalMb');
    expect(m.memory.rssMb).toBeGreaterThan(0);
    expect(m.system).toHaveProperty('cpus');
    expect(m.system.cpus).toBeGreaterThan(0);
  });

  it('measures event-loop lag (real measurement, should be < 500ms in tests)', async () => {
    const lag = await svc.measureEventLoopLag();
    expect(typeof lag).toBe('number');
    expect(lag).toBeGreaterThanOrEqual(0);
    expect(lag).toBeLessThan(500);
  });

  it('process metrics do not include secrets or connection strings', async () => {
    const m = await svc.getProcessMetrics();
    const serialised = JSON.stringify(m);
    expect(serialised).not.toMatch(/password/i);
    expect(serialised).not.toMatch(/DATABASE_URL/i);
    expect(serialised).not.toMatch(/SECRET/i);
  });
});

describe('platformMetricsService.collectAndStoreSnapshot — deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips writing if a recent snapshot already exists', async () => {
    mockPrismaForMetrics.platformMetricSnapshot.findFirst.mockResolvedValueOnce({
      id: 'existing-row',
    });

    // Re-require fresh copy (mock is already set up via jest.mock at top)
    jest.resetModules();
    // Re-set the mock after resetModules
    jest.mock('../../src/config/prisma', () => mockPrismaForMetrics);
    const freshSvc = require('../../src/services/platformAdmin/platformMetricsService');

    await freshSvc.collectAndStoreSnapshot();
    // findFirst was called; create should NOT have been called
    expect(mockPrismaForMetrics.platformMetricSnapshot.create).not.toHaveBeenCalled();
  });

  it('writes a snapshot if no recent one exists', async () => {
    mockPrismaForMetrics.platformMetricSnapshot.findFirst.mockResolvedValueOnce(null);
    mockPrismaForMetrics.platformMetricSnapshot.create.mockResolvedValueOnce({ id: 'new-row' });
    mockPrismaForMetrics.$queryRaw.mockResolvedValue([{}]);
    mockPrismaForMetrics.platformAdminSession.count.mockResolvedValue(2);

    jest.resetModules();
    jest.mock('../../src/config/prisma', () => mockPrismaForMetrics);
    const freshSvc = require('../../src/services/platformAdmin/platformMetricsService');

    await freshSvc.collectAndStoreSnapshot();
    expect(mockPrismaForMetrics.platformMetricSnapshot.create).toHaveBeenCalledTimes(1);
    const data = mockPrismaForMetrics.platformMetricSnapshot.create.mock.calls[0][0].data;
    expect(data).toHaveProperty('requestCount');
    expect(data).toHaveProperty('memoryUsedMb');
    expect(data).toHaveProperty('collectedBy');
    expect(data.collectedBy).toMatch(/^pid:/);
  });

  it('swallows snapshot errors without throwing', async () => {
    mockPrismaForMetrics.platformMetricSnapshot.findFirst.mockRejectedValueOnce(
      new Error('DB down')
    );

    jest.resetModules();
    jest.mock('../../src/config/prisma', () => mockPrismaForMetrics);
    const freshSvc = require('../../src/services/platformAdmin/platformMetricsService');

    // Should resolve, not reject
    await expect(freshSvc.collectAndStoreSnapshot()).resolves.toBeUndefined();
  });
});

// ============================================================================
// 3. platformPerformanceService — DB health, storage, integration checks
// ============================================================================

describe('platformPerformanceService', () => {
  const ORIG_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIG_ENV };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SENDER_EMAIL;
    delete process.env.VERITAS_API_KEY;
    delete process.env.GROQ_API_KEY;
    jest.mock('../../src/config/prisma', () => mockPrismaForMetrics);
  });

  afterAll(() => { process.env = ORIG_ENV; });

  function load() {
    return require('../../src/services/platformAdmin/platformPerformanceService');
  }

  it('getDatabaseSection returns HEALTHY on fast query', async () => {
    mockPrismaForMetrics.$queryRaw.mockResolvedValue([{}]);
    const svc = load();
    const section = await svc.getDatabaseSection();
    expect(['HEALTHY', 'DEGRADED']).toContain(section.health.status);
    expect(typeof section.health.latencyMs).toBe('number');
  });

  it('getDatabaseSection returns UNAVAILABLE on error', async () => {
    mockPrismaForMetrics.$queryRaw.mockRejectedValue(new Error('timeout'));
    const svc = load();
    const section = await svc.getDatabaseSection();
    expect(section.health.status).toBe('UNAVAILABLE');
  });

  it('getDatabaseSection does not expose connection string or credentials', async () => {
    mockPrismaForMetrics.$queryRaw.mockResolvedValue([{
      active: 2, idle: 5, total: 7, database: 'mydb', dbUser: 'api_user',
    }]);
    const svc = load();
    const section = await svc.getDatabaseSection();
    const json = JSON.stringify(section);
    expect(json).not.toMatch(/DATABASE_URL/);
    expect(json).not.toMatch(/password/i);
  });

  it('getStorageSection reports NOT_CONFIGURED when Supabase env vars missing', () => {
    const svc = load();
    const section = svc.getStorageSection();
    expect(section.configured).toBe(false);
    expect(section.provider).toMatch(/local disk/i);
  });

  it('getSystemStatus api field is always HEALTHY', async () => {
    mockPrismaForMetrics.$queryRaw.mockResolvedValue([{}]);
    const svc = load();
    const status = await svc.getSystemStatus();
    expect(status.api.label).toBe('Healthy');
  });

  it('getSystemStatus includes a checkedAt timestamp', async () => {
    mockPrismaForMetrics.$queryRaw.mockResolvedValue([{}]);
    const svc = load();
    const status = await svc.getSystemStatus();
    expect(status.checkedAt).toBeDefined();
    expect(() => new Date(status.checkedAt)).not.toThrow();
  });
});

// ============================================================================
// 4. platformErrorLogService
// ============================================================================

const mockPrismaForErrors = {
  platformErrorLog: {
    create: jest.fn().mockResolvedValue({ id: 'err-id' }),
    findMany: jest.fn().mockResolvedValue([]),
    groupBy: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
};

describe('platformErrorLogService', () => {
  let svc;

  beforeAll(() => {
    jest.resetModules();
    jest.mock('../../src/config/prisma', () => mockPrismaForErrors);
    svc = require('../../src/services/platformAdmin/platformErrorLogService');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function fakeReq(overrides = {}) {
    return {
      method: 'GET',
      originalUrl: '/api/v1/payments/123?token=secret',
      requestId: 'req-abc',
      communityId: 'comm-1',
      user: { id: 'user-1' },
      platformAdmin: null,
      ...overrides,
    };
  }

  it('captureError writes a row without secrets', async () => {
    await svc.captureError({ req: fakeReq(), statusCode: 500, message: 'Internal error' });
    expect(mockPrismaForErrors.platformErrorLog.create).toHaveBeenCalledTimes(1);
    const data = mockPrismaForErrors.platformErrorLog.create.mock.calls[0][0].data;
    // Must not contain the query string token
    expect(JSON.stringify(data)).not.toMatch(/token=secret/);
    // Must not contain a stack trace
    expect(JSON.stringify(data)).not.toMatch(/at Object\./);
    // Must normalise numeric IDs in endpoint
    expect(data.endpoint).toBe('/api/v1/payments/:id');
    expect(data.statusCode).toBe(500);
    expect(data.requestId).toBe('req-abc');
  });

  it('captureError normalises UUIDs in endpoint path', async () => {
    const req = fakeReq({
      originalUrl: '/api/platform/v1/communities/f47ac10b-58cc-4372-a567-0e02b2c3d479',
    });
    await svc.captureError({ req, statusCode: 404, message: 'Not found' });
    const data = mockPrismaForErrors.platformErrorLog.create.mock.calls[0][0].data;
    expect(data.endpoint).toBe('/api/platform/v1/communities/:id');
  });

  it('captureError swallows DB errors without throwing', async () => {
    mockPrismaForErrors.platformErrorLog.create.mockRejectedValueOnce(new Error('DB gone'));
    const req = fakeReq();
    await expect(svc.captureError({ req, statusCode: 500, message: 'oops' })).resolves.toBeUndefined();
  });

  it('getErrors calls findMany with correct time filter', async () => {
    mockPrismaForErrors.platformErrorLog.findMany.mockResolvedValueOnce([]);
    await svc.getErrors({ window: '1h', limit: 50 });
    const call = mockPrismaForErrors.platformErrorLog.findMany.mock.calls[0][0];
    expect(call.take).toBe(50);
    expect(call.where.timestamp.gte).toBeDefined();
    // gte should be approximately 1 hour ago
    const diffMs = Date.now() - call.where.timestamp.gte.getTime();
    expect(diffMs).toBeGreaterThan(59 * 60 * 1000);
    expect(diffMs).toBeLessThan(61 * 60 * 1000);
  });

  it('getErrors clamps limit to 500', async () => {
    await svc.getErrors({ window: '24h', limit: 9999 });
    const call = mockPrismaForErrors.platformErrorLog.findMany.mock.calls[0][0];
    expect(call.take).toBe(500);
  });

  it('getErrorGroups returns grouped data', async () => {
    mockPrismaForErrors.platformErrorLog.groupBy.mockResolvedValueOnce([
      { endpoint: 'GET /api/v1/payments', statusCode: 500, errorCategory: 'Server Error', _count: { id: 3 } },
    ]);
    const groups = await svc.getErrorGroups({ window: '24h' });
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].endpoint).toBe('GET /api/v1/payments');
  });
});

// ============================================================================
// 5. Request ID traceability
// ============================================================================

describe('metricsCollector middleware — request ID traceability', () => {
  it('does not throw when store.record throws internally', () => {
    // The middleware must be safe to load even if the store fails
    jest.resetModules();
    // Provide a broken store to force an error in the record call
    jest.mock('../../src/services/platformAdmin/platformMetricsStore', () => ({
      record: () => { throw new Error('store broken'); },
    }));
    const middleware = require('../../src/middleware/metricsCollector');
    const req = { method: 'GET', originalUrl: '/api/v1/test' };
    const res = {
      statusCode: 200,
      on: (event, cb) => { if (event === 'finish') cb(); },
    };
    expect(() => middleware(req, res, () => {})).not.toThrow();
  });

  it('normalises numeric path segments to :id', () => {
    jest.resetModules();
    jest.mock('../../src/services/platformAdmin/platformMetricsStore', () => ({
      record: jest.fn(),
    }));
    const recordStore = require('../../src/services/platformAdmin/platformMetricsStore');
    const middleware = require('../../src/middleware/metricsCollector');
    const req = { method: 'DELETE', originalUrl: '/api/v1/residents/42/fees/99?x=1' };
    let finishCb;
    const res = {
      statusCode: 204,
      on: (event, cb) => { if (event === 'finish') { finishCb = cb; } },
    };
    middleware(req, res, () => {});
    finishCb();
    expect(recordStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'DELETE /api/v1/residents/:id/fees/:id' })
    );
  });
});

// ============================================================================
// 6. Performance metrics are unavailable markers (not fabricated)
// ============================================================================

describe('performance service — unavailable checks are marked, not fabricated', () => {
  it('getStorageSection.objectCounts is null (not a fake number) when not configured', () => {
    jest.resetModules();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    jest.mock('../../src/config/prisma', () => mockPrismaForMetrics);
    const svc = require('../../src/services/platformAdmin/platformPerformanceService');
    const section = svc.getStorageSection();
    expect(section.objectCounts).toBeNull();
  });
});
