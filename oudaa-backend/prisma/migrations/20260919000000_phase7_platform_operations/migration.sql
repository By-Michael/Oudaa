-- Phase 7: Platform operations & control center

CREATE TYPE "PlatformAnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'ARCHIVED');
CREATE TYPE "PlatformAnnouncementType" AS ENUM ('INFO', 'WARNING', 'MAINTENANCE', 'SECURITY');
CREATE TYPE "PlatformNotificationSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');
CREATE TYPE "PlatformExportType" AS ENUM ('COMMUNITIES', 'USERS', 'AUDIT_LOGS', 'SUPPORT_TICKETS', 'FINANCIAL_AGGREGATE');
CREATE TYPE "PlatformExportFormat" AS ENUM ('CSV', 'XLSX', 'JSON');
CREATE TYPE "PlatformExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

CREATE TABLE "platform_feature_flags" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "rolloutPercentage" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_feature_flags_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_feature_flags_rolloutPercentage_check" CHECK ("rolloutPercentage" BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX "platform_feature_flags_key_environment_key" ON "platform_feature_flags"("key", "environment");
CREATE INDEX "platform_feature_flags_environment_idx" ON "platform_feature_flags"("environment");
CREATE INDEX "platform_feature_flags_enabled_idx" ON "platform_feature_flags"("enabled");

CREATE TABLE "platform_feature_flag_targets" (
  "featureFlagId" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  CONSTRAINT "platform_feature_flag_targets_pkey" PRIMARY KEY ("featureFlagId", "communityId"),
  CONSTRAINT "platform_feature_flag_targets_featureFlagId_fkey" FOREIGN KEY ("featureFlagId") REFERENCES "platform_feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "platform_feature_flag_targets_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "platform_feature_flag_targets_communityId_idx" ON "platform_feature_flag_targets"("communityId");

CREATE TABLE "platform_maintenance" (
  "id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "message" TEXT NOT NULL DEFAULT 'The platform is temporarily unavailable while maintenance is performed.',
  "expectedDurationMins" INTEGER,
  "allowPlatformAdmins" BOOLEAN NOT NULL DEFAULT true,
  "allowSupportAgents" BOOLEAN NOT NULL DEFAULT true,
  "enabledAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "platform_maintenance_pkey" PRIMARY KEY ("id")
);

INSERT INTO "platform_maintenance" ("id", "updatedAt")
VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "platform_announcements" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "type" "PlatformAnnouncementType" NOT NULL DEFAULT 'INFO',
  "status" "PlatformAnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledFor" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "targetAll" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_announcements_status_idx" ON "platform_announcements"("status");
CREATE INDEX "platform_announcements_scheduledFor_idx" ON "platform_announcements"("scheduledFor");
CREATE INDEX "platform_announcements_expiresAt_idx" ON "platform_announcements"("expiresAt");

CREATE TABLE "platform_announcement_targets" (
  "announcementId" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  CONSTRAINT "platform_announcement_targets_pkey" PRIMARY KEY ("announcementId", "communityId"),
  CONSTRAINT "platform_announcement_targets_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "platform_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "platform_announcement_targets_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "platform_announcement_targets_communityId_idx" ON "platform_announcement_targets"("communityId");

CREATE TABLE "platform_notifications" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" "PlatformNotificationSeverity" NOT NULL DEFAULT 'INFO',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "route" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "platform_notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_notifications_createdAt_idx" ON "platform_notifications"("createdAt");
CREATE INDEX "platform_notifications_severity_idx" ON "platform_notifications"("severity");

CREATE TABLE "platform_notification_reads" (
  "notificationId" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_notification_reads_pkey" PRIMARY KEY ("notificationId", "adminId"),
  CONSTRAINT "platform_notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "platform_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "platform_notification_reads_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "platform_notification_reads_adminId_readAt_idx" ON "platform_notification_reads"("adminId", "readAt");

CREATE TABLE "platform_export_jobs" (
  "id" TEXT NOT NULL,
  "type" "PlatformExportType" NOT NULL,
  "format" "PlatformExportFormat" NOT NULL,
  "status" "PlatformExportStatus" NOT NULL DEFAULT 'QUEUED',
  "filters" JSONB,
  "requestedById" TEXT NOT NULL,
  "filePath" TEXT,
  "contentType" TEXT,
  "fileName" TEXT,
  "sizeBytes" INTEGER,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "platform_export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_export_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "platform_export_jobs_status_createdAt_idx" ON "platform_export_jobs"("status", "createdAt");
CREATE INDEX "platform_export_jobs_requestedById_createdAt_idx" ON "platform_export_jobs"("requestedById", "createdAt");

CREATE TABLE "platform_config_settings" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "valueJson" JSONB,
  "description" TEXT,
  "isSensitive" BOOLEAN NOT NULL DEFAULT false,
  "managedBy" TEXT NOT NULL DEFAULT 'DATABASE',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "platform_config_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_config_settings_category_key_key" ON "platform_config_settings"("category", "key");
CREATE INDEX "platform_config_settings_category_idx" ON "platform_config_settings"("category");
