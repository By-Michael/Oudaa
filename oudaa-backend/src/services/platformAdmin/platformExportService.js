'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const prisma = require('../../config/prisma');
const { isSupabaseConfigured, supabase, SUPABASE_EXPORTS_BUCKET } = require('../../config/storage');
const notificationService = require('./platformNotificationService');

const EXPORT_DIR = process.env.PLATFORM_EXPORT_DIR || path.join(os.tmpdir(), 'oudaa-platform-exports');
const JOB_TTL_MS = 60 * 60 * 1000;
let workerRunning = false;

function sanitizeOperationalMessage(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|access_token|refresh_token|api[_-]?key|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|secret|password|token)\s*[:=]\s*)[^,;\s]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s?]+\?[^\s]+/gi, (url) => url.split('?')[0])
    .slice(0, 500);
}

function safeJson(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(safeJson);
  if (typeof value.toJSON === 'function' && Object.keys(value).length === 0) return value.toJSON();

  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/password|secret|token|api.?key|authorization|cookie/i.test(key)) continue;
    out[key] = safeJson(nested);
  }
  return out;
}

function scalar(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value?.toNumber === 'function') return value.toNumber();
  if (typeof value?.toString === 'function' && value?.constructor?.name === 'Decimal') return value.toString();
  return value;
}

function normaliseRows(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeJson(scalar(value))])));
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(safeJson(value)) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function buildRows(type, filters = {}) {
  switch (type) {
    case 'COMMUNITIES': {
      const where = filters.status ? { status: filters.status } : undefined;
      const rows = await prisma.community.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          address: true,
          createdAt: true,
          updatedAt: true,
          suspendedAt: true,
          suspendedReason: true,
        },
      });
      return normaliseRows(rows);
    }

    case 'USERS': {
      const where = {};
      if (filters.communityId) where.communityId = filters.communityId;
      if (filters.role) where.role = filters.role;
      const rows = await prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          communityId: true,
          createdAt: true,
          updatedAt: true,
          community: { select: { name: true, slug: true } },
        },
      });
      return normaliseRows(rows.map((row) => ({
        id: row.id,
        fullName: row.fullName,
        email: row.email,
        role: row.role,
        communityId: row.communityId,
        communityName: row.community?.name || null,
        communitySlug: row.community?.slug || null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })));
    }

    case 'AUDIT_LOGS': {
      const where = {};
      if (filters.from || filters.to) {
        where.createdAt = {};
        if (filters.from) where.createdAt.gte = new Date(filters.from);
        if (filters.to) where.createdAt.lte = new Date(filters.to);
      }
      if (filters.communityId) where.communityId = filters.communityId;
      const rows = await prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          actorEmail: true,
          actorRole: true,
          action: true,
          entityType: true,
          entityId: true,
          communityId: true,
          description: true,
          success: true,
          createdAt: true,
        },
      });
      return normaliseRows(rows);
    }

    case 'SUPPORT_TICKETS': {
      const where = {};
      if (filters.communityId) where.communityId = filters.communityId;
      if (filters.status) where.status = filters.status;
      const rows = await prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          communityId: true,
          userId: true,
          subject: true,
          status: true,
          priority: true,
          category: true,
          assignedToId: true,
          originConversationId: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
          closedAt: true,
          lastResponseAt: true,
        },
      });
      return normaliseRows(rows);
    }

    case 'FINANCIAL_AGGREGATE': {
      const [communities, payments, expenses] = await Promise.all([
        prisma.community.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } }),
        prisma.payment.groupBy({
          by: ['communityId'],
          where: { status: 'VERIFIED', ...(filters.communityId ? { communityId: filters.communityId } : {}) },
          _sum: { amount: true },
          _count: { id: true },
        }),
        prisma.expense.groupBy({
          by: ['communityId'],
          where: filters.communityId ? { communityId: filters.communityId } : undefined,
          _sum: { amount: true },
          _count: { id: true },
        }),
      ]);
      const paymentMap = new Map(payments.map((row) => [row.communityId, row]));
      const expenseMap = new Map(expenses.map((row) => [row.communityId, row]));
      return communities
        .filter((community) => !filters.communityId || community.id === filters.communityId)
        .map((community) => {
          const paid = paymentMap.get(community.id);
          const spent = expenseMap.get(community.id);
          const verifiedIncome = scalar(paid?._sum?.amount) || 0;
          const expenseTotal = scalar(spent?._sum?.amount) || 0;
          return {
            communityId: community.id,
            communityName: community.name,
            communitySlug: community.slug,
            verifiedPaymentCount: paid?._count?.id || 0,
            verifiedPaymentTotal: verifiedIncome,
            expenseCount: spent?._count?.id || 0,
            expenseTotal,
            netAggregate: Number(verifiedIncome) - Number(expenseTotal),
          };
        });
    }

    default:
      throw Object.assign(new Error(`Unsupported export type: ${type}`), { statusCode: 400 });
  }
}

let exportBucketReady = false;

async function ensureExportBucket() {
  if (exportBucketReady) return;
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase Storage is not configured for platform exports.');
  }
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`Supabase export bucket check failed: ${listError.message}`);
  const exists = (buckets || []).some((bucket) => bucket.name === SUPABASE_EXPORTS_BUCKET);
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(SUPABASE_EXPORTS_BUCKET, { public: false });
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw new Error(`Supabase export bucket creation failed: ${createError.message}`);
    }
  }
  exportBucketReady = true;
}

async function uploadExportToSupabase(fileName, contentType, buffer) {
  await ensureExportBucket();
  const { error } = await supabase.storage
    .from(SUPABASE_EXPORTS_BUCKET)
    .upload(fileName, buffer, { contentType, upsert: false });
  if (error) throw new Error(`Supabase export upload failed: ${error.message}`);
  return { filePath: `supabase://${SUPABASE_EXPORTS_BUCKET}/${fileName}`, sizeBytes: buffer.length };
}

async function writeFile(type, format, rows) {
  const id = crypto.randomUUID();
  const basename = `platform-${type.toLowerCase()}-${id}`;
  let fileName;
  let contentType;
  let buffer;

  if (format === 'JSON') {
    fileName = `${basename}.json`;
    contentType = 'application/json';
    buffer = Buffer.from(JSON.stringify(safeJson(rows), null, 2), 'utf8');
  } else if (format === 'CSV') {
    fileName = `${basename}.csv`;
    contentType = 'text/csv; charset=utf-8';
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const lines = [headers.map(escapeCsv).join(',')];
    for (const row of rows) lines.push(headers.map((key) => escapeCsv(row[key])).join(','));
    buffer = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
  } else if (format === 'XLSX') {
    fileName = `${basename}.xlsx`;
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Export');
    const headers = rows.length ? Object.keys(rows[0]) : [];
    sheet.columns = headers.map((key) => ({ header: key, key }));
    for (const row of rows) sheet.addRow(safeJson(row));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  } else {
    throw Object.assign(new Error(`Unsupported export format: ${format}`), { statusCode: 400 });
  }

  // Render Free has no persistent disk. In production, use the same durable
  // Supabase Storage backend already required for receipt uploads. Keep a
  // local temp-file fallback for local development/tests without Supabase.
  if (isSupabaseConfigured) {
    return { fileName, contentType, ...(await uploadExportToSupabase(fileName, contentType, buffer)) };
  }

  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const filePath = path.join(EXPORT_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  return { fileName, filePath, contentType, sizeBytes: buffer.length };
}

async function createJob({ type, format, filters = {}, requestedById }) {
  return prisma.platformExportJob.create({
    data: {
      type,
      format,
      filters: safeJson(filters),
      requestedById,
      status: 'QUEUED',
    },
  });
}

async function claimNextJob() {
  const candidate = await prisma.platformExportJob.findFirst({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return null;

  const claim = await prisma.platformExportJob.updateMany({
    where: { id: candidate.id, status: 'QUEUED' },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });
  if (claim.count !== 1) return null;
  return prisma.platformExportJob.findUnique({ where: { id: candidate.id } });
}

async function processJob(job) {
  try {
    const rows = await buildRows(job.type, job.filters || {});
    const file = await writeFile(job.type, job.format, rows);
    const expiresAt = new Date(Date.now() + JOB_TTL_MS);
    const completed = await prisma.platformExportJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        filePath: file.filePath,
        contentType: file.contentType,
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
        completedAt: new Date(),
        expiresAt,
        errorMessage: null,
      },
    });
    await notificationService.createNotification({
      type: 'EXPORT_READY',
      severity: 'INFO',
      title: 'Platform export ready',
      message: `${job.type} ${job.format} export is ready for download.`,
      route: '/platform-admin/exports',
      metadata: { jobId: job.id, type: job.type, format: job.format },
      expiresAt,
    }).catch(() => {});
    return completed;
  } catch (error) {
    await prisma.platformExportJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', errorMessage: sanitizeOperationalMessage(error.message), completedAt: new Date() },
    }).catch(() => {});
    await notificationService.createNotification({
      type: 'INTEGRATION_FAILURE',
      severity: 'ERROR',
      title: 'Platform export failed',
      message: `${job.type} ${job.format} export failed.`,
      route: '/platform-admin/exports',
      metadata: { jobId: job.id, type: job.type, format: job.format, error: sanitizeOperationalMessage(error.message) },
    }).catch(() => {});
    return null;
  }
}

async function processQueuedJobs() {
  if (workerRunning) return null;
  workerRunning = true;
  try {
    const job = await claimNextJob();
    return job ? processJob(job) : null;
  } finally {
    workerRunning = false;
  }
}

function startWorker() {
  if (startWorker.started) return;
  startWorker.started = true;
  const interval = Math.max(Number(process.env.PLATFORM_EXPORT_WORKER_INTERVAL_MS) || 5000, 1000);
  setInterval(() => { processQueuedJobs().catch(() => {}); }, interval).unref?.();
  processQueuedJobs().catch(() => {});
}

async function cleanupExpiredJobs() {
  const jobs = await prisma.platformExportJob.findMany({
    where: { status: { in: ['COMPLETED', 'FAILED'] }, expiresAt: { lt: new Date() } },
    select: { id: true, filePath: true },
    take: 200,
  });
  if (!jobs.length) return 0;
  for (const job of jobs) {
    if (!job.filePath) continue;
    if (job.filePath.startsWith('supabase://')) {
      try {
        const [, bucket, ...keyParts] = job.filePath.split('/');
        const key = keyParts.join('/');
        if (bucket && key && isSupabaseConfigured && supabase) {
          await supabase.storage.from(bucket).remove([key]);
        }
      } catch (_err) { /* best effort; database expiry must still complete */ }
      continue;
    }
    try { fs.unlinkSync(job.filePath); } catch (_err) { /* file may already be gone */ }
  }
  await prisma.platformExportJob.updateMany({ where: { id: { in: jobs.map((job) => job.id) } }, data: { status: 'EXPIRED', filePath: null } });
  return jobs.length;
}

async function listJobs(requestedById, { status } = {}) {
  return prisma.platformExportJob.findMany({
    where: { requestedById, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, type: true, format: true, status: true, fileName: true, sizeBytes: true, errorMessage: true, createdAt: true, startedAt: true, completedAt: true, expiresAt: true },
  });
}

async function getJobForAdmin(id, adminId) {
  return prisma.platformExportJob.findFirst({ where: { id, requestedById: adminId } });
}

async function download(job, res) {
  if (job.status !== 'COMPLETED' || !job.filePath || !job.fileName) throw Object.assign(new Error('Export is not ready'), { statusCode: 409 });

  res.setHeader('Content-Type', job.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${job.fileName.replace(/["\\]/g, '')}"`);

  if (job.filePath.startsWith('supabase://')) {
    if (!isSupabaseConfigured || !supabase) throw Object.assign(new Error('Export storage is unavailable'), { statusCode: 503 });
    const [, bucket, ...keyParts] = job.filePath.split('/');
    const key = keyParts.join('/');
    if (!bucket || !key) throw Object.assign(new Error('Invalid export storage path'), { statusCode: 500 });
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, 60);
    if (error || !data?.signedUrl) throw Object.assign(new Error('Export file has expired or is unavailable'), { statusCode: 410 });
    return res.redirect(302, data.signedUrl);
  }

  const exportRoot = path.resolve(EXPORT_DIR);
  const resolved = path.resolve(job.filePath);
  if (!resolved.startsWith(`${exportRoot}${path.sep}`)) throw Object.assign(new Error('Invalid export path'), { statusCode: 500 });
  if (!fs.existsSync(resolved)) throw Object.assign(new Error('Export file has expired or is unavailable'), { statusCode: 410 });
  return res.sendFile(resolved);
}

module.exports = { createJob, processQueuedJobs, startWorker, cleanupExpiredJobs, listJobs, getJobForAdmin, download, safeJson, buildRows };
