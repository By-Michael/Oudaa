'use strict';

const prisma = require('../../config/prisma');

function computedStatus(row, now = new Date()) {
  if (row.status === 'DRAFT' || row.status === 'ARCHIVED') return row.status;
  if (row.expiresAt && new Date(row.expiresAt) <= now) return 'EXPIRED';
  if (row.scheduledFor && new Date(row.scheduledFor) > now) return 'SCHEDULED';
  return row.publishedAt || row.status === 'PUBLISHED' ? 'PUBLISHED' : row.status;
}

function serialise(row) {
  return { ...row, effectiveStatus: computedStatus(row) };
}

async function list({ status, type, search } = {}) {
  const where = {};
  if (status && status !== 'ALL') where.status = status;
  if (type && type !== 'ALL') where.type = type;
  if (search?.trim()) where.OR = [{ title: { contains: search.trim(), mode: 'insensitive' } }, { message: { contains: search.trim(), mode: 'insensitive' } }];
  const rows = await prisma.platformAnnouncement.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }],
    include: { targets: { include: { community: { select: { id: true, name: true, slug: true } } } } },
  });
  return rows.map(serialise);
}

async function get(id) {
  const row = await prisma.platformAnnouncement.findUnique({
    where: { id },
    include: { targets: { include: { community: { select: { id: true, name: true, slug: true } } } } },
  });
  return row ? serialise(row) : null;
}

async function create(data) {
  const targetAll = data.targetAll !== false;
  return prisma.platformAnnouncement.create({
    data: {
      title: data.title.trim(),
      message: data.message.trim(),
      type: data.type || 'INFO',
      status: data.scheduledFor && new Date(data.scheduledFor) > new Date() ? 'SCHEDULED' : 'DRAFT',
      targetAll,
      scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      targets: !targetAll && data.communityIds?.length ? { create: [...new Set(data.communityIds)].map((communityId) => ({ communityId })) } : undefined,
    },
    include: { targets: { include: { community: { select: { id: true, name: true, slug: true } } } } },
  });
}

async function update(id, data) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.platformAnnouncement.findUnique({ where: { id } });
    if (!current) throw Object.assign(new Error('Announcement not found'), { statusCode: 404 });
    const targetAll = data.targetAll === undefined ? current.targetAll : Boolean(data.targetAll);
    await tx.platformAnnouncement.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.message !== undefined ? { message: data.message.trim() } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.targetAll !== undefined ? { targetAll } : {}),
        ...(data.scheduledFor !== undefined ? { scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null } : {}),
        ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null } : {}),
      },
    });
    if (data.communityIds !== undefined || data.targetAll !== undefined) {
      await tx.platformAnnouncementTarget.deleteMany({ where: { announcementId: id } });
      if (!targetAll && data.communityIds?.length) {
        await tx.platformAnnouncementTarget.createMany({ data: [...new Set(data.communityIds)].map((communityId) => ({ announcementId: id, communityId })) });
      }
    }
    return tx.platformAnnouncement.findUnique({ where: { id }, include: { targets: { include: { community: { select: { id: true, name: true, slug: true } } } } } });
  });
}

async function publish(id) {
  return prisma.platformAnnouncement.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date(), scheduledFor: null } });
}
async function schedule(id, scheduledFor) {
  return prisma.platformAnnouncement.update({ where: { id }, data: { status: 'SCHEDULED', scheduledFor: new Date(scheduledFor), publishedAt: null } });
}
async function archive(id) { return prisma.platformAnnouncement.update({ where: { id }, data: { status: 'ARCHIVED' } }); }

async function activeForCommunity(communityId) {
  const now = new Date();
  return prisma.platformAnnouncement.findMany({
    where: {
      OR: [
        { targetAll: true },
        { targetAll: false, targets: { some: { communityId } } },
      ],
      status: { in: ['PUBLISHED', 'SCHEDULED'] },
      AND: [
        { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ],
    },
    orderBy: [{ type: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, title: true, message: true, type: true, publishedAt: true, expiresAt: true },
  });
}

module.exports = { list, get, create, update, publish, schedule, archive, activeForCommunity, computedStatus };
