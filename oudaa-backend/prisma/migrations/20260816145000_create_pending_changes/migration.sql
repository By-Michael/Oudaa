-- pending_changes / pending_change_approvals were declared on the Prisma
-- schema (PendingChange / PendingChangeApproval) but no migration ever
-- actually created them — later migrations only ALTER them (adding
-- autoApproved in 20260816150000, communityId in 20260908000000). Create
-- the base tables here, in their pre-those-migrations shape, so the
-- history replays correctly on a fresh/production database.

CREATE TYPE "PendingChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

CREATE TABLE IF NOT EXISTS "pending_changes" (
    "id"           TEXT NOT NULL,
    "communityId"  TEXT NOT NULL,
    "changeType"   TEXT NOT NULL,
    "entityType"   TEXT NOT NULL,
    "entityId"     TEXT NOT NULL,
    "diff"         JSONB NOT NULL,
    "status"       "PendingChangeStatus" NOT NULL DEFAULT 'PENDING',
    "proposedById" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "resolvedAt"   TIMESTAMP(3),

    CONSTRAINT "pending_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pending_changes_communityId_status_idx"
    ON "pending_changes"("communityId", "status");
CREATE INDEX IF NOT EXISTS "pending_changes_entityType_entityId_status_idx"
    ON "pending_changes"("entityType", "entityId", "status");

DO $$ BEGIN
    ALTER TABLE "pending_changes" ADD CONSTRAINT "pending_changes_communityId_fkey"
        FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "pending_changes" ADD CONSTRAINT "pending_changes_proposedById_fkey"
        FOREIGN KEY ("proposedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "pending_change_approvals" (
    "id"              TEXT NOT NULL,
    "pendingChangeId" TEXT NOT NULL,
    "committeeUserId" TEXT NOT NULL,
    "decision"        "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "respondedAt"     TIMESTAMP(3),

    CONSTRAINT "pending_change_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pending_change_approvals_pendingChangeId_committeeUserId_key"
    ON "pending_change_approvals"("pendingChangeId", "committeeUserId");

DO $$ BEGIN
    ALTER TABLE "pending_change_approvals" ADD CONSTRAINT "pending_change_approvals_pendingChangeId_fkey"
        FOREIGN KEY ("pendingChangeId") REFERENCES "pending_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "pending_change_approvals" ADD CONSTRAINT "pending_change_approvals_committeeUserId_fkey"
        FOREIGN KEY ("committeeUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
