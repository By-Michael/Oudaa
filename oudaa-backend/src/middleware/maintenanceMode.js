'use strict';

const maintenanceService = require('../services/platformAdmin/platformMaintenanceService');

module.exports = async function maintenanceMode(req, res, next) {
  try {
    const state = await maintenanceService.getMaintenance();
    if (!state.enabled) return next();

    res.status(503).json({
      success: false,
      maintenance: true,
      message: state.message,
      expectedDurationMinutes: state.expectedDurationMins,
      startedAt: state.enabledAt,
      requestId: req.requestId,
      code: 'PLATFORM_MAINTENANCE',
    });
  } catch (_err) {
    // Availability control must fail open if its own DB lookup fails.
    next();
  }
};
