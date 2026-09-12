-- PENDING_REVIEW was added to the PaymentStatus enum in schema.prisma (for
-- self-verified payments that got a bank match but failed our own
-- safeguard checks — see the model comment) but no migration ever added
-- it to the actual Postgres enum type, which only ever had PENDING,
-- VERIFIED, REJECTED from the init migration. Any self-verify flow landing
-- in PENDING_REVIEW has been failing with a Postgres enum error ever since
-- that feature was written.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW' BEFORE 'VERIFIED';
