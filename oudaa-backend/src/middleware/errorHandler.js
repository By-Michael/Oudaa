const { Prisma } = require('@prisma/client');
const AppError = require('../utils/AppError');
let _notificationService = null;
function getNotificationService() {
  if (!_notificationService) {
    try { _notificationService = require('../services/platformAdmin/platformNotificationService'); } catch (_) {}
  }
  return _notificationService;
}
// Phase 5: capture structured error records (async, best-effort — failures
// are swallowed so the error handler itself can never recursively fail).
let _errorLogService = null;
function getErrorLogService() {
  if (!_errorLogService) {
    try { _errorLogService = require('../services/platformAdmin/platformErrorLogService'); } catch (_) {}
  }
  return _errorLogService;
}

function mapPrismaError(err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return new AppError(
          `A record with this ${err.meta?.target?.join(', ') || 'value'} already exists`,
          409
        );
      case 'P2025':
        return new AppError('Record not found', 404);
      case 'P2003':
        return new AppError('Related record not found (invalid foreign key)', 400);
      default:
        return new AppError('Database error', 400);
    }
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return new AppError('Invalid data provided to database query', 400);
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  let error = err;

  const prismaMapped = mapPrismaError(err);
  if (prismaMapped) error = prismaMapped;

  if (!error.statusCode) {
    error = new AppError(error.message || 'Internal server error', 500);
  }

  // Always log server-side, regardless of env or status code. This used to
  // only log 500s in non-production, which meant Render (NODE_ENV=production)
  // never logged ANY error server-side — including the original Prisma error
  // getting mapped to a generic 400 message, making prod issues undebuggable
  // from the logs. Client response still stays generic/no-stack in prod.
  console.error(`[${req.method} ${req.originalUrl}]${req.requestId ? ` [${req.requestId}]` : ''}`, err);

  // Phase 5: persist a structured, safe error record. Latency is approximate
  // (we don't have the start timestamp here; metricsCollector captures it).
  // We only log 4xx and 5xx that are genuine operational errors (skip 401/403
  // noise from unauthenticated probes in the error log to keep it clean).
  if (error.statusCode >= 400) {
    const svc = getErrorLogService();
    if (svc) {
      svc.captureError({ req, statusCode: error.statusCode, message: error.message }).catch(() => {});
    }
  }

  if (error.statusCode >= 500) {
    const notifications = getNotificationService();
    if (notifications) {
      notifications.createNotification({
        type: 'SERVICE_FAILURE',
        severity: 'ERROR',
        title: 'Service failure detected',
        message: `${req.method} ${req.path} returned a server error. Request ${req.requestId || 'untracked'}.`,
        route: '/platform-admin/notifications',
        metadata: { requestId: req.requestId || null, statusCode: error.statusCode },
      }).catch(() => {});
    }
  }

  res.status(error.statusCode).json({
    success: false,
    message: error.message,
    details: error.details,
    requestId: req.requestId,
    ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  });
};
