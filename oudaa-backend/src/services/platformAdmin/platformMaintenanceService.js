'use strict';

const prisma = require('../../config/prisma');

let cache = { value: null, expiresAt: 0 };
const TTL_MS = 2_000;

function invalidateMaintenanceCache() { cache = { value: null, expiresAt: 0 }; }

async function getMaintenance(forceFresh = false) {
  if (!forceFresh && cache.value && cache.expiresAt > Date.now()) return cache.value;
  const row = await prisma.platformMaintenance.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  });
  cache = { value: row, expiresAt: Date.now() + TTL_MS };
  return row;
}

async function updateMaintenance({ enabled, message, expectedDurationMins, allowPlatformAdmins, allowSupportAgents, updatedById }) {
  const current = await getMaintenance(true);
  const nextEnabled = Boolean(enabled);
  const row = await prisma.platformMaintenance.update({
    where: { id: 'default' },
    data: {
      enabled: nextEnabled,
      ...(message !== undefined ? { message: String(message).trim() || current.message } : {}),
      ...(expectedDurationMins !== undefined ? { expectedDurationMins: expectedDurationMins === null ? null : Number(expectedDurationMins) } : {}),
      ...(allowPlatformAdmins !== undefined ? { allowPlatformAdmins: Boolean(allowPlatformAdmins) } : {}),
      ...(allowSupportAgents !== undefined ? { allowSupportAgents: Boolean(allowSupportAgents) } : {}),
      enabledAt: nextEnabled ? new Date() : current.enabledAt,
      disabledAt: nextEnabled ? null : new Date(),
      updatedById: updatedById || null,
    },
  });
  invalidateMaintenanceCache();
  return row;
}

module.exports = { getMaintenance, updateMaintenance, invalidateMaintenanceCache };
