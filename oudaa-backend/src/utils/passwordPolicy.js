'use strict';

const AppError = require('./AppError');

/**
 * Validates a candidate password against the operator-configurable
 * password policy (see services/platformAdmin/platformSecuritySettingsService).
 * Throws an AppError(400) with a human-readable message on the first rule
 * violated, rather than a Zod schema, because the policy itself is
 * runtime data (not knowable at schema-definition time) — see
 * validate.js's header comment on why it only supports static schemas.
 */
function assertPasswordMeetsPolicy(password, settings) {
  const min = settings?.passwordMinLength ?? 12;
  if (typeof password !== 'string' || password.length < min) {
    throw new AppError(`Password must be at least ${min} characters`, 400);
  }
  if (settings?.passwordRequireUppercase && !/[A-Z]/.test(password)) {
    throw new AppError('Password must include at least one uppercase letter', 400);
  }
  if (settings?.passwordRequireNumber && !/[0-9]/.test(password)) {
    throw new AppError('Password must include at least one number', 400);
  }
  if (settings?.passwordRequireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    throw new AppError('Password must include at least one symbol', 400);
  }
}

module.exports = { assertPasswordMeetsPolicy };
