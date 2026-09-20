'use strict';

const catchAsync = require('../../utils/catchAsync');
const aiService = require('../../services/platformAdmin/platformSupportAiService');

/**
 * GET /platform/v1/support/ai/config
 * Safe configuration metadata only — enabled/provider/model. Never the
 * API key itself (there is no field here that could even leak it).
 */
const config = catchAsync(async (req, res) => {
  res.json({ success: true, data: aiService.getAiConfig() });
});

const metrics = catchAsync(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  const [metricsData, escalations] = await Promise.all([
    aiService.getAiMetrics({ days }),
    aiService.getHumanEscalationCount({ days }),
  ]);
  res.json({ success: true, data: { ...metricsData, humanEscalations: escalations } });
});

const conversations = catchAsync(async (req, res) => {
  const result = await aiService.listAiConversations({
    communityId: req.query.communityId,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, ...result });
});

module.exports = { config, metrics, conversations };
