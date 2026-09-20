'use strict';

const crypto = require('crypto');
const prisma = require('../../config/prisma');

function normalisePercentage(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error('rolloutPercentage must be an integer from 0 to 100');
  return n;
}

function rolloutBucket(key, subject) {
  const digest = crypto.createHash('sha256').update(`${key}:${subject}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function serialise(flag) {
  return {
    id: flag.id,
    key: flag.key,
    description: flag.description,
    enabled: flag.enabled,
    environment: flag.environment,
    rolloutPercentage: flag.rolloutPercentage,
    targets: (flag.targets || []).map((t) => ({
      communityId: t.communityId,
      community: t.community ? { id: t.community.id, name: t.community.name, slug: t.community.slug } : null,
    })),
    targetCount: flag.targets?.length || 0,
    createdAt: flag.createdAt,
    updatedAt: flag.updatedAt,
  };
}

async function listFlags({ environment, search } = {}) {
  const where = {};
  if (environment) where.environment = environment;
  if (search?.trim()) {
    where.OR = [
      { key: { contains: search.trim(), mode: 'insensitive' } },
      { description: { contains: search.trim(), mode: 'insensitive' } },
    ];
  }
  const rows = await prisma.platformFeatureFlag.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }],
    include: { targets: { include: { community: { select: { id: true, name: true, slug: true } } } } },
  });
  return rows.map(serialise);
}

async function getFlag(id) {
  const flag = await prisma.platformFeatureFlag.findUnique({
    where: { id },
    include: { targets: { include: { community: { select: { id: true, name: true, slug: true } } } } },
  });
  return flag ? serialise(flag) : null;
}

async function getFlagByKey(key, environment = 'production') {
  return prisma.platformFeatureFlag.findFirst({ where: { key, environment } });
}

async function createFlag(data) {
  const rolloutPercentage = normalisePercentage(data.rolloutPercentage ?? 100);
  return prisma.platformFeatureFlag.create({
    data: {
      key: data.key.trim(),
      description: data.description?.trim() || null,
      enabled: Boolean(data.enabled),
      environment: (data.environment || 'production').trim(),
      rolloutPercentage,
      targets: data.communityIds?.length ? {
        create: [...new Set(data.communityIds)].map((communityId) => ({ communityId })),
      } : undefined,
    },
    include: { targets: { include: { community: { select: { id: true, name: true, slug: true } } } } },
  });
}

async function updateFlag(id, data) {
  const rolloutPercentage = data.rolloutPercentage === undefined ? undefined : normalisePercentage(data.rolloutPercentage);
  return prisma.$transaction(async (tx) => {
    const flag = await tx.platformFeatureFlag.update({
      where: { id },
      data: {
        ...(data.key !== undefined ? { key: data.key.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.enabled !== undefined ? { enabled: Boolean(data.enabled) } : {}),
        ...(data.environment !== undefined ? { environment: data.environment.trim() } : {}),
        ...(rolloutPercentage !== undefined ? { rolloutPercentage } : {}),
      },
    });
    if (data.communityIds !== undefined) {
      await tx.platformFeatureFlagTarget.deleteMany({ where: { featureFlagId: id } });
      if (data.communityIds.length) {
        await tx.platformFeatureFlagTarget.createMany({
          data: [...new Set(data.communityIds)].map((communityId) => ({ featureFlagId: id, communityId })),
        });
      }
    }
    return tx.platformFeatureFlag.findUnique({
      where: { id: flag.id },
      include: { targets: { include: { community: { select: { id: true, name: true, slug: true } } } } },
    });
  });
}

async function deleteFlag(id) {
  return prisma.platformFeatureFlag.delete({ where: { id } });
}

async function evaluateFlag({ key, environment = 'production', communityId, userId }) {
  const flag = await getFlagByKey(key, environment);
  if (!flag || !flag.enabled) return false;

  const targetCount = await prisma.platformFeatureFlagTarget.count({ where: { featureFlagId: flag.id } });
  if (targetCount > 0) {
    if (!communityId) return false;
    const target = await prisma.platformFeatureFlagTarget.findUnique({
      where: { featureFlagId_communityId: { featureFlagId: flag.id, communityId } },
      select: { communityId: true },
    });
    if (!target) return false;
  }

  if (flag.rolloutPercentage >= 100) return true;
  if (flag.rolloutPercentage <= 0) return false;

  const subject = communityId || userId;
  if (!subject) return false;
  return rolloutBucket(flag.key, subject) < flag.rolloutPercentage;
}

async function history(id, { page = 1, pageSize = 50 } = {}) {
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  return prisma.platformAuditLog.findMany({
    where: { entityType: 'PlatformFeatureFlag', entityId: id },
    orderBy: { createdAt: 'desc' },
    skip,
    take,
    select: { id: true, action: true, actorEmail: true, actorRole: true, description: true, metadata: true, success: true, createdAt: true },
  });
}

module.exports = { listFlags, getFlag, createFlag, updateFlag, deleteFlag, evaluateFlag, history, rolloutBucket };
