'use strict';

const prisma = require('../../config/prisma');

async function createNotification({ type, severity = 'INFO', title, message, route, metadata, expiresAt }) {
  return prisma.platformNotification.create({
    data: { type, severity, title, message, route: route || null, metadata: metadata || undefined, expiresAt: expiresAt || null },
  });
}

async function listForAdmin(adminId, { limit = 30, unreadOnly = false } = {}) {
  const take = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const now = new Date();
  const rows = await prisma.platformNotification.findMany({
    where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], ...(unreadOnly ? { reads: { none: { adminId } } } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
    include: { reads: { where: { adminId }, select: { readAt: true } } },
  });
  return rows.map((n) => ({ ...n, readAt: n.reads[0]?.readAt || null, reads: undefined }));
}

async function unreadCount(adminId) {
  const now = new Date();
  return prisma.platformNotification.count({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], reads: { none: { adminId } } } });
}

async function markRead(adminId, notificationId) {
  return prisma.platformNotificationRead.upsert({
    where: { notificationId_adminId: { notificationId, adminId } },
    create: { notificationId, adminId },
    update: { readAt: new Date() },
  });
}

async function markAllRead(adminId) {
  const unread = await prisma.platformNotification.findMany({ where: { reads: { none: { adminId } } }, select: { id: true } });
  if (!unread.length) return 0;
  await prisma.platformNotificationRead.createMany({ data: unread.map((n) => ({ notificationId: n.id, adminId })) });
  return unread.length;
}

module.exports = { createNotification, listForAdmin, unreadCount, markRead, markAllRead };
