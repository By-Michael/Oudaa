'use strict';

const catchAsync = require('../../utils/catchAsync');
const perfService = require('../../services/platformAdmin/platformPerformanceService');
const telemetry = require('../../services/platformAdmin/platformIntegrationTelemetryService');

const INTEGRATIONS = ['database', 'storage', 'email', 'payment', 'ai'];

const list = catchAsync(async (req, res) => {
  const raw = await perfService.getIntegrationsSection();
  const data = {};
  for (const key of INTEGRATIONS) {
    const current = raw[key] || {};
    const details = await telemetry.getIntegrationTelemetry(key);
    data[key] = {
      ...current,
      configured: current.status !== 'NOT_CONFIGURED',
      lastSuccessfulOperation: details.lastSuccess,
      lastFailure: details.lastFailure,
      errorCount: details.errorCount,
      errorWindowHours: details.errorWindowHours,
      telemetrySource: details.source,
    };
  }

  res.json({ success: true, data, checkedAt: new Date().toISOString() });
});

module.exports = { list };
