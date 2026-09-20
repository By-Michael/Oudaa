'use strict';

const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');

const MAX_PAGE_SIZE = 100;

function parseDate(value, label) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${label} must be a valid date`, 400);
  }
  return date;
}

function buildWhere(query = {}) {
  const where = {};
  const and = [];
  const search = String(query.search || '').trim();

  if (search) {
    and.push({
      OR: [
        { action: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
        { entityId: { contains: search, mode: 'insensitive' } },
        { actorEmail: { contains: search, mode: 'insensitive' } },
        { requestId: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  if (query.actor) {
    const actor = String(query.actor).trim();
    and.push({
      OR: [
        { actorId: actor },
        { actorEmail: { contains: actor, mode: 'insensitive' } },
      ],
    });
  }

  if (and.length) where.AND = and;
  if (query.action) where.action = String(query.action).trim();
  if (query.entity) where.entityType = String(query.entity).trim();
  if (query.entityId) where.entityId = String(query.entityId).trim();
  if (query.communityId) where.communityId = String(query.communityId).trim();
  if (query.requestId) where.requestId = String(query.requestId).trim();

  if (query.success === 'true' || query.success === 'false') {
    where.success = query.success === 'true';
  }

  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }

  return where;
}

async function listAuditLogs(query = {}) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize, 10) || 50, 1), MAX_PAGE_SIZE);
  const where = buildWhere(query);

  const [total, rows] = await Promise.all([
    prisma.platformAuditLog.count({ where }),
    prisma.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        actorId: true,
        actorEmail: true,
        actorRole: true,
        action: true,
        entityType: true,
        entityId: true,
        communityId: true,
        description: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        requestId: true,
        success: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    data: rows,
    pagination: {
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function getAuditLog(id) {
  return prisma.platformAuditLog.findUnique({
    where: { id },
    select: {
      id: true,
      actorId: true,
      actorEmail: true,
      actorRole: true,
      action: true,
      entityType: true,
      entityId: true,
      communityId: true,
      description: true,
      metadata: true,
      ipAddress: true,
      userAgent: true,
      requestId: true,
      success: true,
      createdAt: true,
    },
  });
}

module.exports = { buildWhere, listAuditLogs, getAuditLog };
