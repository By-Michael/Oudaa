const { randomUUID } = require('crypto');

/**
 * Attaches a correlation/request ID to every request — reused verbatim in
 * logs, error responses, and (for platform-admin routes) audit events, so
 * a single request can be traced across all three. Honors an inbound
 * X-Request-Id from a trusted upstream proxy/load balancer if present,
 * otherwise generates a fresh UUID.
 */
module.exports = function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.requestId = (typeof incoming === 'string' && incoming.trim()) || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
