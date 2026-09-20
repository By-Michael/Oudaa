const catchAsync = require('../../utils/catchAsync');
const dashboardService = require('../../services/platformAdmin/platformDashboardService');
const healthService = require('../../services/platformAdmin/platformHealthService');
const alertsService = require('../../services/platformAdmin/platformAlertsService');
const activityService = require('../../services/platformAdmin/platformActivityService');

/**
 * The main platform overview payload: core metrics + financial aggregates
 * + system health, in one round trip (Phase 2's "keep the response
 * efficient" — one request rather than the frontend firing off several).
 * Charts, alerts, and recent activity are separate endpoints since
 * they're heavier/optional and the dashboard shell should render its
 * numbers before charts finish.
 */
const summary = catchAsync(async (req, res) => {
  const [{ metrics, financial, generatedAt }, systemStatus] = await Promise.all([
    dashboardService.getSummary(),
    healthService.getSystemStatus(),
  ]);

  res.json({
    success: true,
    data: { metrics, financial, systemStatus, generatedAt },
  });
});

const growthChart = catchAsync(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  const data = await dashboardService.getGrowthChart(days);
  res.json({ success: true, data });
});

const financialActivityChart = catchAsync(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  const data = await dashboardService.getFinancialActivityChart(days);
  res.json({ success: true, data });
});

const alerts = catchAsync(async (req, res) => {
  const data = await alertsService.getAlerts();
  res.json({ success: true, data });
});

const recentActivity = catchAsync(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const data = await activityService.getRecentActivity(req.platformAdmin.role, { limit });
  res.json({ success: true, data });
});

module.exports = { summary, growthChart, financialActivityChart, alerts, recentActivity };
