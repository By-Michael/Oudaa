const { recordPlatformAudit } = require('../../services/platformAdmin/platformAuditService');

/**
 * Route middleware that records a PlatformAuditLog entry once the response
 * has actually been sent, using whatever status code the handler produced
 * to decide success/failure. Meant for routes where the audit fields are
 * knowable up front from the request; for actions needing detail only the
 * controller has (e.g. "changed role from X to Y"), call
 * recordPlatformAudit directly from the controller instead and skip this
 * middleware on that route.
 *
 * Usage: router.get('/communities/:id', authenticatePlatformAdmin,
 *   requirePlatformPermission(...), auditPlatformAction({ action: 'COMMUNITY_VIEWED',
 *   entityType: 'Community', entityId: (req) => req.params.id }), handler)
 */
module.exports = function auditPlatformAction({ action, entityType, entityId, description, communityId }) {
  return (req, res, next) => {
    res.on('finish', () => {
      const resolvedEntityId = typeof entityId === 'function' ? entityId(req) : entityId;
      const resolvedCommunityId = typeof communityId === 'function' ? communityId(req) : communityId;
      const resolvedDescription =
        typeof description === 'function'
          ? description(req)
          : description || `${action} on ${entityType}${resolvedEntityId ? ` (${resolvedEntityId})` : ''}`;

      recordPlatformAudit(req, {
        action,
        entityType,
        entityId: resolvedEntityId,
        communityId: resolvedCommunityId,
        description: resolvedDescription,
        success: res.statusCode < 400,
      });
    });
    next();
  };
};
