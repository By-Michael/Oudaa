-- payments.feeId was left NOT NULL from the init migration, but
-- schema.prisma declares it nullable (feeId String?) — a payment can be
-- for a fee, a project, or a fund (see the Payment model comment on
-- feeId/projectId/fundId), and 20260808120000_add_payment_fund_relation
-- added fund-only payment support without ever relaxing this constraint.
-- Any fund- or project-only payment insert has been failing against a
-- correctly-deployed database ever since.
ALTER TABLE "payments" ALTER COLUMN "feeId" DROP NOT NULL;
