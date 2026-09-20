'use strict';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, GROQ_API_KEY: 'sk-real-secret-key-value', SUPPORT_AI_MODEL: 'openai/gpt-oss-120b' };
});
afterAll(() => {
  process.env = ORIGINAL_ENV;
});

jest.mock('../../src/config/prisma', () => ({
  supportAiRequestLog: {
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _avg: { latencyMs: null }, _min: { createdAt: null } }),
    findMany: jest.fn().mockResolvedValue([]),
  },
  supportChatSession: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
  supportTicket: { count: jest.fn().mockResolvedValue(0) },
  community: { findMany: jest.fn().mockResolvedValue([]) },
}));

describe('platformSupportAiService.getAiConfig — never leaks the API key', () => {
  it('the returned object has no field containing the actual key value', () => {
    const { getAiConfig } = require('../../src/services/platformAdmin/platformSupportAiService');
    const config = getAiConfig();
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain('sk-real-secret-key-value');
    expect(serialized).not.toContain(process.env.GROQ_API_KEY);
  });

  it('only exposes the documented safe fields: enabled, provider, model, fallbackModels', () => {
    const { getAiConfig } = require('../../src/services/platformAdmin/platformSupportAiService');
    const config = getAiConfig();
    expect(Object.keys(config).sort()).toEqual(['enabled', 'fallbackModels', 'model', 'provider']);
  });

  it('reports enabled:false when GROQ_API_KEY is unset, without erroring', () => {
    delete process.env.GROQ_API_KEY;
    jest.resetModules();
    const { getAiConfig } = require('../../src/services/platformAdmin/platformSupportAiService');
    expect(getAiConfig().enabled).toBe(false);
  });
});

describe('platformSupportAiService.getAiMetrics', () => {
  it('reports null averageLatencyMs and successRate when there is no data yet (never fabricates)', async () => {
    const { getAiMetrics } = require('../../src/services/platformAdmin/platformSupportAiService');
    const metrics = await getAiMetrics({ days: 30 });
    expect(metrics.requestCount).toBe(0);
    expect(metrics.averageLatencyMs).toBeNull();
    expect(metrics.successRate).toBeNull();
  });

  it('discloses metricsAvailableSince so callers know history may be partial', async () => {
    const { getAiMetrics } = require('../../src/services/platformAdmin/platformSupportAiService');
    const metrics = await getAiMetrics({ days: 30 });
    expect(metrics).toHaveProperty('metricsAvailableSince');
  });
});
