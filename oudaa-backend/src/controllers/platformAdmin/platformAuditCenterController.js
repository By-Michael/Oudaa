'use strict';

const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const service = require('../../services/platformAdmin/platformAuditCenterService');

const list = catchAsync(async (req, res) => {
  const result = await service.listAuditLogs(req.query);
  res.json({ success: true, ...result });
});

const detail = catchAsync(async (req, res) => {
  const row = await service.getAuditLog(req.params.id);
  if (!row) throw new AppError('Audit event not found', 404);
  res.json({ success: true, data: row });
});

module.exports = { list, detail };
