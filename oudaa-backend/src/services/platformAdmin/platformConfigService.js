'use strict';

const prisma = require('../../config/prisma');

const DEFAULTS = [
  ['general', 'defaultLocale', 'en', false, 'Default platform locale.'],
  ['general', 'allowNewCommunitySignup', true, false, 'Whether new community signups are accepted.'],
  ['support', 'defaultSlaHours', 24, false, 'Default support SLA target in hours.'],
  ['ai', 'enabled', true, false, 'Whether AI support features are enabled.'],
  ['email', 'enabled', true, false, 'Whether outbound transactional email is enabled.'],
  ['payments', 'verificationEnabled', true, false, 'Whether payment verification integrations are enabled.'],
  ['storage', 'provider', 'supabase', false, 'Selected object storage provider.'],
  ['performance', 'cacheTtlSeconds', 15, false, 'Default operations dashboard cache TTL.'],
  ['maintenance', 'defaultMessage', 'The platform is temporarily unavailable while maintenance is performed.', false, 'Default maintenance message.'],
  ['feature-flags', 'defaultEnvironment', 'production', false, 'Default environment for feature flags.'],
  ['email', 'apiKey', null, true, 'Managed server-side. Never returned to the browser.'],
  ['payments', 'providerSecret', null, true, 'Managed server-side. Never returned to the browser.'],
  ['storage', 'serviceRoleKey', null, true, 'Managed server-side. Never returned to the browser.'],
];

async function ensureDefaults() {
  for (const [category, key, value, isSensitive, description] of DEFAULTS) {
    const managedBy = isSensitive ? 'ENVIRONMENT' : 'DATABASE';
    await prisma.platformConfigSetting.upsert({
      where: { category_key: { category, key } },
      create: { category, key, valueJson: value, isSensitive, description, managedBy },
      // Keep existing sensitive rows aligned with the deployment-managed
      // contract even if this service was upgraded after the rows were first
      // created.
      update: isSensitive ? { managedBy: 'ENVIRONMENT' } : {},
    });
  }
}

function serialise(row) {
  return {
    id: row.id,
    category: row.category,
    key: row.key,
    value: row.isSensitive ? null : row.valueJson,
    isSensitive: row.isSensitive,
    managedBy: row.managedBy,
    description: row.description,
    updatedAt: row.updatedAt,
  };
}

async function list({ category } = {}) {
  await ensureDefaults();
  const where = category ? { category } : {};
  const rows = await prisma.platformConfigSetting.findMany({ where, orderBy: [{ category: 'asc' }, { key: 'asc' }] });
  return rows.map(serialise);
}

async function update(id, value, updatedById) {
  const current = await prisma.platformConfigSetting.findUnique({ where: { id } });
  if (!current) return null;
  return prisma.platformConfigSetting.update({
    where: { id },
    data: { valueJson: value, updatedById },
  });
}

module.exports = { ensureDefaults, list, update };
