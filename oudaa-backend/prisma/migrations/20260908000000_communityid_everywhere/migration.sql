-- Two things, bundled together because both are "every tenant-owned row
-- is unambiguously and directly tied to its community" work:
--
-- 1) communities.slug — a unique, URL-safe handle used for the
--    subdomain-per-community routing (acme.oudaa.app). Every existing
--    community gets one backfilled from its name (+ a short id suffix to
--    guarantee uniqueness without needing app logic during the
--    migration); src/utils/slugify.js generates nicer, still-unique slugs
--    for every community created from here on.
--
-- 2) communityId, denormalized directly onto every remaining table that
--    only had it reachable via a join (Resident via user, Receipt via
--    expense, ProjectFundAllocation via project/fund, the two approval
--    tables via their parent request/change, RefreshToken/
--    PasswordResetToken/SupportChatMessage via user/session). Matches the
--    pattern already used for Payment/Expense (see migration
--    20260813052537_denormalize_community_id) — every tenant-scoped query
--    becomes a plain indexed equality filter instead of a join, and no
--    table is ever left to be scoped "by association" only.

-- ---------------------------------------------------------------------
-- 1) communities.slug
-- ---------------------------------------------------------------------
ALTER TABLE "communities" ADD COLUMN "slug" TEXT;

UPDATE "communities"
SET "slug" = lower(
  regexp_replace(
    regexp_replace(trim("name"), '[^a-zA-Z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g'
  )
) || '-' || substr("id", 1, 6)
WHERE "slug" IS NULL;

ALTER TABLE "communities" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "communities_slug_key" ON "communities"("slug");

-- ---------------------------------------------------------------------
-- 2) Resident.communityId (from user.communityId)
-- ---------------------------------------------------------------------
ALTER TABLE "residents" ADD COLUMN "communityId" TEXT;

UPDATE "residents" r
SET "communityId" = u."communityId"
FROM "users" u
WHERE u."id" = r."userId";

-- A resident row is only ever created alongside a User that already has a
-- communityId (see authController.registerCommunity / residentController.
-- createResident), so every row should have backfilled cleanly; this is a
-- safety net, not the expected path.
DELETE FROM "residents" WHERE "communityId" IS NULL;

ALTER TABLE "residents" ALTER COLUMN "communityId" SET NOT NULL;
ALTER TABLE "residents" ADD CONSTRAINT "residents_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "residents_communityId_idx" ON "residents"("communityId");

-- ---------------------------------------------------------------------
-- 3) Receipt.communityId (from expense.communityId)
-- ---------------------------------------------------------------------
ALTER TABLE "receipts" ADD COLUMN "communityId" TEXT;

UPDATE "receipts" r
SET "communityId" = e."communityId"
FROM "expenses" e
WHERE e."id" = r."expenseId";

ALTER TABLE "receipts" ALTER COLUMN "communityId" SET NOT NULL;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "receipts_communityId_idx" ON "receipts"("communityId");

-- ---------------------------------------------------------------------
-- 4) ProjectFundAllocation.communityId (from project.communityId)
-- ---------------------------------------------------------------------
ALTER TABLE "project_fund_allocations" ADD COLUMN "communityId" TEXT;

UPDATE "project_fund_allocations" pfa
SET "communityId" = p."communityId"
FROM "projects" p
WHERE p."id" = pfa."projectId";

ALTER TABLE "project_fund_allocations" ALTER COLUMN "communityId" SET NOT NULL;
ALTER TABLE "project_fund_allocations" ADD CONSTRAINT "project_fund_allocations_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "project_fund_allocations_communityId_idx" ON "project_fund_allocations"("communityId");

-- ---------------------------------------------------------------------
-- 5) CommitteeTransferApproval.communityId (from request.communityId)
-- ---------------------------------------------------------------------
ALTER TABLE "committee_transfer_approvals" ADD COLUMN "communityId" TEXT;

UPDATE "committee_transfer_approvals" a
SET "communityId" = req."communityId"
FROM "committee_transfer_requests" req
WHERE req."id" = a."requestId";

ALTER TABLE "committee_transfer_approvals" ALTER COLUMN "communityId" SET NOT NULL;
ALTER TABLE "committee_transfer_approvals" ADD CONSTRAINT "committee_transfer_approvals_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "committee_transfer_approvals_communityId_idx" ON "committee_transfer_approvals"("communityId");

-- ---------------------------------------------------------------------
-- 6) PendingChangeApproval.communityId (from pendingChange.communityId)
-- ---------------------------------------------------------------------
ALTER TABLE "pending_change_approvals" ADD COLUMN "communityId" TEXT;

UPDATE "pending_change_approvals" a
SET "communityId" = pc."communityId"
FROM "pending_changes" pc
WHERE pc."id" = a."pendingChangeId";

ALTER TABLE "pending_change_approvals" ALTER COLUMN "communityId" SET NOT NULL;
ALTER TABLE "pending_change_approvals" ADD CONSTRAINT "pending_change_approvals_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "pending_change_approvals_communityId_idx" ON "pending_change_approvals"("communityId");

-- ---------------------------------------------------------------------
-- 7) RefreshToken.communityId (from user.communityId — nullable, mirrors
--    User.communityId itself being nullable)
-- ---------------------------------------------------------------------
ALTER TABLE "refresh_tokens" ADD COLUMN "communityId" TEXT;

UPDATE "refresh_tokens" t
SET "communityId" = u."communityId"
FROM "users" u
WHERE u."id" = t."userId";

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "refresh_tokens_communityId_idx" ON "refresh_tokens"("communityId");

-- ---------------------------------------------------------------------
-- 8) PasswordResetToken.communityId (from user.communityId — nullable)
-- ---------------------------------------------------------------------
ALTER TABLE "password_reset_tokens" ADD COLUMN "communityId" TEXT;

UPDATE "password_reset_tokens" t
SET "communityId" = u."communityId"
FROM "users" u
WHERE u."id" = t."userId";

ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "password_reset_tokens_communityId_idx" ON "password_reset_tokens"("communityId");

-- ---------------------------------------------------------------------
-- 9) SupportChatMessage.communityId (from session.communityId — nullable)
-- ---------------------------------------------------------------------
ALTER TABLE "support_chat_messages" ADD COLUMN "communityId" TEXT;

UPDATE "support_chat_messages" m
SET "communityId" = s."communityId"
FROM "support_chat_sessions" s
WHERE s."id" = m."sessionId";

ALTER TABLE "support_chat_messages" ADD CONSTRAINT "support_chat_messages_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "support_chat_messages_communityId_idx" ON "support_chat_messages"("communityId");
