const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// Rate limiters for endpoints that are either (a) backed by a paid
// external API call per request, or (b) a security-sensitive code/guess
// flow where the general '/api' limiter (app.js, 1500/15min) is far too
// loose to matter. Each one is deliberately keyed by the signed-in
// user's id rather than IP where the route is authenticated — a shared
// office/NAT IP shouldn't throttle everyone in a building together, but
// a single account hammering an expensive endpoint should be stopped
// regardless of which IP it comes from.
//
// See authRoutes.js's authLimiter and supportRoutes.js's chatLimiter for
// the two limiters that predate this file — left in place as-is.

function byUserThenIp(req) {
  return req.user?.id || ipKeyGenerator(req.ip);
}

// Bank-verification (self-verify) and OCR (parse-screenshot) both call a
// real external API per request that Oudaa pays for, and self-verify in
// particular is also a fraud-probing surface (guessing which transaction
// IDs/amounts happen to verify) — worth throttling harder than ordinary
// CRUD even though every caller here is already authenticated.
const externalApiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUserThenIp,
  message: { success: false, message: 'Too many verification attempts. Please wait a few minutes and try again.' },
});

// Requesting a profile-change OTP (see userController.requestProfileOtp)
// already has an application-level 60s cooldown stored in the database,
// but that check-then-insert isn't wrapped in a transaction, so a burst
// of near-simultaneous requests could all pass the cooldown check before
// any of them commits. This is a cheap backstop against that race, and
// against just plain spamming your own inbox.
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUserThenIp,
  message: { success: false, message: 'Too many verification codes requested. Please wait before requesting another.' },
});

// Verifying a code (phone OTP, or the OTP check inside avatar upload)
// already has a database-tracked 5-attempt cap per code
// (ProfileChangeOtp.attempts), but the same race-condition gap applies —
// concurrent requests could all read attempts < 5 before any of them
// writes the increment. This closes that gap and also rate-limits
// across MULTIPLE codes (someone requesting a fresh code every time
// they exhaust one).
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUserThenIp,
  message: { success: false, message: 'Too many attempts. Please request a new code and try again.' },
});

// Public, unauthenticated — this is every community's login page doing
// a lookup before anyone has a token, so it must stay IP-keyed (there's
// no req.user yet). Not credential-stuffing-sensitive the way /auth is,
// but it's a plain slug-enumeration surface (script through /a, /ab,
// /abc... and see which resolve) that the loose general limiter alone
// doesn't meaningfully deter.
const slugLookupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many lookups. Please wait a few minutes and try again.' },
});

module.exports = { externalApiLimiter, otpRequestLimiter, otpVerifyLimiter, slugLookupLimiter };
