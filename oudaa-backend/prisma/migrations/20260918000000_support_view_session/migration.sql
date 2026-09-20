-- Phase 3: Platform Support View Sessions
-- Short-lived read-only operator windows into community user accounts.
-- Not a FK to community users to preserve the tenant boundary.

CREATE TABLE "platform_support_views" (
    "id"                TEXT NOT NULL,
    "operatorId"        TEXT NOT NULL,
    "operatorEmail"     TEXT NOT NULL,
    "targetUserId"      TEXT NOT NULL,
    "targetEmail"       TEXT NOT NULL,
    "targetCommunityId" TEXT NOT NULL,
    "expiresAt"         TIMESTAMP(3) NOT NULL,
    "revoked"           BOOLEAN NOT NULL DEFAULT false,
    "revokedAt"         TIMESTAMP(3),
    "ipAddress"         TEXT,
    "userAgent"         TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_support_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_support_views_operatorId_idx"   ON "platform_support_views"("operatorId");
CREATE INDEX "platform_support_views_targetUserId_idx" ON "platform_support_views"("targetUserId");
CREATE INDEX "platform_support_views_expiresAt_idx"    ON "platform_support_views"("expiresAt");

ALTER TABLE "platform_support_views"
    ADD CONSTRAINT "platform_support_views_operatorId_fkey"
    FOREIGN KEY ("operatorId")
    REFERENCES "platform_admins"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
