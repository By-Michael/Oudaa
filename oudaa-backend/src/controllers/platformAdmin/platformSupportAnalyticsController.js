'use strict';

const catchAsync = require('../../utils/catchAsync');
const analyticsService = require('../../services/platformAdmin/platformSupportAnalyticsService');

const overview = catchAsync(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  const data = await analyticsService.getOverview({ days });
  res.json({ success: true, data });
});

const volumeChart = catchAsync(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  const data = await analyticsService.getVolumeChart({ days });
  res.json({ success: true, data });
});

module.exports = { overview, volumeChart };
