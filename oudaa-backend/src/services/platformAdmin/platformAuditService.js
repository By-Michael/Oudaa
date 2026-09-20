const prisma = require('../../config/prisma');

/**
 * Records one entry in the platform audit trail. Mirrors the "best effort"
 * pattern of utils/audit.js (a logging failure must never break the
 * primary action) but writes to the completely separate PlatformAuditLog
 * table — never AuditLog — and pulls the actor from req.platformAdmin
 * (never req.user).
 *
 * @param {import('express').Request} req
 * @param {Object} opts
 * @param {string} opts.action - e.g. LOGIN_SUCCESS, LOGIN_FAILED, ROLE_CHANGED
 * @param {string} opts.entityType - e.g. PlatformAdmin, PlatformAdminSession
 * @param {string} [opts.entityId]
 * @param {string} [opts.communityId] - set when the action concerned a specific tenant
 * @param {string} opts.description
 * @param {Object} [opts.metadata]
 * @param {boolean} [opts.success=true]
 */
async function recordPlatformAudit(req, { action, entityType, entityId, communityId, description, metadata, success = true }) {
  try {
    const actor = req.platformAdmin;
    await prisma.platformAuditLog.create({
      data: {
        actorId: actor?.id || null,
        actorEmail: actor?.email || null,
        actorRole: actor?.role || null,
        action,
        entityType,
        entityId: entityId || null,
        communityId: communityId || null,
        description,
        metadata: metadata || undefined,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        requestId: req.requestId || null,
        success,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to write platform audit log:', err.message);
  }
}

/**
 * Convenience for recording a failed/unauthenticated attempt where there is
 * no req.platformAdmin yet (e.g. a bad login) — action + description carry
 * the identifying detail instead.
 */
async function recordPlatformAuditUnauthenticated(req, { action, entityType, description, metadata, attemptedEmail }) {
  try {
    await prisma.platformAuditLog.create({
      data: {
        actorEmail: attemptedEmail || null,
        action,
        entityType,
        description,
        metadata: metadata || undefined,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        requestId: req.requestId || null,
        success: false,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to write platform audit log:', err.message);
  }
}

module.exports = { recordPlatformAudit, recordPlatformAuditUnauthenticated };
