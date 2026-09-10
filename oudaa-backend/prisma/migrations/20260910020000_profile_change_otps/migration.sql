-- Email-verified OTP gate for self-service phone/avatar changes. Only the
-- OTP's hash is stored (mirrors password_reset_tokens/refresh_tokens);
-- single-use via consumedAt, short-lived via expiresAt (10 minutes,
-- enforced in application code), rate-limited per-code via attempts.
CREATE TABLE "profile_change_otps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_change_otps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "profile_change_otps_userId_type_idx" ON "profile_change_otps"("userId", "type");

ALTER TABLE "profile_change_otps" ADD CONSTRAINT "profile_change_otps_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
