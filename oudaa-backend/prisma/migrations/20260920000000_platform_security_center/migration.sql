-- Phase 6: Security Center & Platform Admin Management
--
-- 1. platform_admins: adds lastFailedLoginAt/lastFailedLoginIp (so the
--    Security dashboard and the Platform Admins list can show "last failed
--    login" without scanning the audit log), plus mustChangePassword /
--    mfaReenrollmentRequired flags for forced re-credentialing.
-- 2. platform_security_settings: new singleton table for the adjustable
--    security controls (session duration, password policy, login rate
--    limiting, MFA-for-all toggle, trusted origins).

ALTER TABLE "platform_admins"
  ADD COLUMN "lastFailedLoginAt" TIMESTAMP(3),
  ADD COLUMN "lastFailedLoginIp" TEXT,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaReenrollmentRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "platform_security_settings" (
    "id"                          TEXT NOT NULL DEFAULT 'default',
    "sessionDurationMinutes"      INTEGER NOT NULL DEFAULT 43200,
    "passwordMinLength"           INTEGER NOT NULL DEFAULT 12,
    "passwordRequireUppercase"    BOOLEAN NOT NULL DEFAULT true,
    "passwordRequireNumber"       BOOLEAN NOT NULL DEFAULT true,
    "passwordRequireSymbol"       BOOLEAN NOT NULL DEFAULT false,
    "loginRateLimitMax"           INTEGER NOT NULL DEFAULT 10,
    "loginRateLimitWindowMinutes" INTEGER NOT NULL DEFAULT 15,
    "mfaRequiredForAllAdmins"     BOOLEAN NOT NULL DEFAULT false,
    "trustedOrigins"              JSONB NOT NULL DEFAULT '[]',
    "updatedAt"                   TIMESTAMP(3) NOT NULL,
    "updatedById"                 TEXT,

    CONSTRAINT "platform_security_settings_pkey" PRIMARY KEY ("id")
);
