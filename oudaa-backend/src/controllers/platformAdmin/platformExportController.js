'use strict';
const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const service = require('../../services/platformAdmin/platformExportService');
const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');

const TYPES = ['COMMUNITIES', 'USERS', 'AUDIT_LOGS', 'SUPPORT_TICKETS', 'FINANCIAL_AGGREGATE'];
const FORMATS = ['CSV', 'XLSX', 'JSON'];

const create = catchAsync(async (req, res) => {
  if (!TYPES.includes(req.body.type)) throw new AppError(`type must be one of: ${TYPES.join(', ')}`, 400);
  if (!FORMATS.includes(req.body.format)) throw new AppError(`format must be one of: ${FORMATS.join(', ')}`, 400);
  const job = await service.createJob({ type: req.body.type, format: req.body.format, filters: req.body.filters || {}, requestedById: req.platformAdmin.id });
  await recordPlatformAudit(req, { action: 'DATA_EXPORT_REQUESTED', entityType: 'PlatformExportJob', entityId: job.id, description: `${job.type} ${job.format} export requested.`, metadata: { type: job.type, format: job.format, filters: job.filters || {} } });
  service.startWorker();
  res.status(202).json({ success: true, data: job });
});
const list = catchAsync(async (req, res) => res.json({ success: true, data: await service.listJobs(req.platformAdmin.id, { status: req.query.status }) }));
const download = catchAsync(async (req, res) => {
  const job = await service.getJobForAdmin(req.params.id, req.platformAdmin.id);
  if (!job) throw new AppError('Export job not found', 404);
  await recordPlatformAudit(req, { action: 'DATA_EXPORT_DOWNLOADED', entityType: 'PlatformExportJob', entityId: job.id, description: `Export ${job.id} downloaded.`, metadata: { type: job.type, format: job.format, sizeBytes: job.sizeBytes } });
  await service.download(job, res);
});
module.exports = { create, list, download };
