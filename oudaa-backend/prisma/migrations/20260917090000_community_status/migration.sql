-- Platform-admin Phase 2: adds a platform-controlled operational status to
-- Community so "active communities" / "suspended communities" dashboard
-- metrics are real. Purely additive; every existing row defaults to ACTIVE.

-- CreateEnum
CREATE TYPE "CommunityStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "communities" ADD COLUMN "status" "CommunityStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "communities" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "communities" ADD COLUMN "suspendedReason" TEXT;

-- CreateIndex
CREATE INDEX "communities_status_idx" ON "communities"("status");
