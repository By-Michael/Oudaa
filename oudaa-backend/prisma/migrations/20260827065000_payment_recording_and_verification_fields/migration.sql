-- receiptUrl, recordedBy, verificationRaw, and reviewFlags were declared on
-- the Payment model in schema.prisma but no migration ever actually added
-- them to the table — same class of gap as payments.projectId and
-- pending_changes/pending_change_approvals. Adding them here:
--   - receiptUrl: optional photo/PDF of a physical receipt for
--     committee-recorded (cash/in-person) payments.
--   - recordedBy: which committee member manually recorded this payment on
--     a resident's behalf (null for self-verified payments). SET NULL like
--     verifiedBy, so deleting that user's account doesn't delete payment
--     history.
--   - verificationRaw: raw bank-verification provider response, kept for
--     admin review of self-verified payments.
--   - reviewFlags: human-readable reason(s) a self-verified payment was
--     flagged for review.

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "receiptUrl" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "recordedBy" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "verificationRaw" JSONB;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "reviewFlags" TEXT;

DO $$ BEGIN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedBy_fkey"
        FOREIGN KEY ("recordedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
