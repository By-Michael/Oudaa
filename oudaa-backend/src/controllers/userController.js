const crypto = require('crypto');
const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { saveAvatarFile, deleteAvatarFile } = require('../config/storage');
const { hashToken } = require('../utils/tokens');
const { phoneSearchKeyFor } = require('../utils/phone');
const { sendProfileOtpEmail } = require('../utils/email');
const { recordAudit } = require('../utils/audit');

const OTP_EXPIRES_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
// Blocks someone from spamming themselves (or someone else's inbox, if
// the email were ever attacker-controlled — it isn't here since it's
// always the signed-in user's own address, but cheap insurance) with
// repeated code requests.
const OTP_REQUEST_COOLDOWN_SECONDS = 60;

function generateOtp() {
  // A random 6-digit code, zero-padded — crypto.randomInt is
  // cryptographically strong, unlike Math.random(), which matters since
  // this code is the entire security barrier for the change it gates.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// PATCH /users/me/preferences — shallow-merges the posted keys into the
// user's stored preferences JSON, rather than requiring the whole object
// every time. This is what backs theme, sidebar-collapsed, default export
// format, and per-category notification mutes — all previously separate
// localStorage keys, now a single database column so they follow the user
// to any device/browser they sign into.
// POST /users/me/otp/request — kicks off email verification for a
// self-service PHONE or AVATAR change. Stores the new phone value now
// (for PHONE) so verify-phone doesn't need it resent and can't be
// tricked into applying a different number than what was actually
// emailed out; AVATAR carries no payload since the file itself only
// exists at upload time.
const requestProfileOtp = catchAsync(async (req, res) => {
  const { type, phone } = req.body;
  if (!['PHONE', 'AVATAR'].includes(type)) {
    throw new AppError('type must be PHONE or AVATAR', 422);
  }
  if (type === 'PHONE' && !phone?.trim()) {
    throw new AppError('phone is required for a PHONE verification', 422);
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError('User not found', 404);

  const recent = await prisma.profileChangeOtp.findFirst({
    where: { userId: user.id, type, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (recent && Date.now() - new Date(recent.createdAt).getTime() < OTP_REQUEST_COOLDOWN_SECONDS * 1000) {
    throw new AppError('Please wait a moment before requesting another code.', 429);
  }

  const otp = generateOtp();

  await prisma.profileChangeOtp.create({
    data: {
      userId: user.id,
      type,
      payload: type === 'PHONE' ? { phone: phone.trim() } : undefined,
      otpHash: hashToken(otp),
      expiresAt: new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000),
    },
  });

  const result = await sendProfileOtpEmail({
    to: user.email,
    fullName: user.fullName,
    otp,
    purpose: type,
    expiresInMinutes: OTP_EXPIRES_MINUTES,
  });

  // If email genuinely isn't configured (stub mode — e.g. local dev with
  // no BREVO_API_KEY), there's no other channel to deliver the code
  // through, so surface it in the response rather than silently issuing
  // a code nobody can ever see. In a real deployment with Brevo
  // configured this branch never runs and the code only ever reaches
  // the user's inbox.
  res.json({
    success: true,
    message: `A verification code was sent to ${user.email}.`,
    data: result.stub ? { stubOtp: otp } : undefined,
  });
});

// Shared lookup + validation for both verify endpoints below: finds the
// newest live (unconsumed, unexpired) OTP of the given type for this
// user, checks the submitted code against it, and increments the
// attempt counter either way so a wrong guess still counts against the
// rate limit.
async function consumeOtp({ userId, type, otp }) {
  const row = await prisma.profileChangeOtp.findFirst({
    where: { userId, type, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw new AppError('That code has expired. Please request a new one.', 400);
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw new AppError('Too many incorrect attempts. Please request a new code.', 429);
  }
  if (hashToken(String(otp || '').trim()) !== row.otpHash) {
    await prisma.profileChangeOtp.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new AppError('That code doesn\u2019t match. Check the code and try again.', 400);
  }
  await prisma.profileChangeOtp.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return row;
}

// POST /users/me/otp/verify-phone — confirms the code and applies the
// phone number captured at request time (see requestProfileOtp) to this
// resident, keeping phoneSearchKey in sync so phone-based login keeps
// working (see authController.login's phone lookup).
const verifyPhoneOtp = catchAsync(async (req, res) => {
  const { otp } = req.body;
  const otpRow = await consumeOtp({ userId: req.user.id, type: 'PHONE', otp });
  const phone = otpRow.payload?.phone;
  if (!phone) throw new AppError('No pending phone change found for this code.', 400);

  const resident = await prisma.resident.findUnique({ where: { userId: req.user.id } });
  if (!resident) throw new AppError('Resident profile not found', 404);

  const updated = await prisma.resident.update({
    where: { id: resident.id },
    data: { phone, phoneSearchKey: phoneSearchKeyFor(phone) },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entityType: 'Resident',
    entityId: resident.id,
    description: `${req.user.fullName} updated their own phone number (email-verified)`,
  });

  res.json({ success: true, data: updated });
});

const updatePreferences = catchAsync(async (req, res) => {
  const current = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { preferences: true },
  });

  const merged = { ...(current?.preferences || {}), ...(req.body || {}) };

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { preferences: merged },
    select: { preferences: true },
  });

  res.json({ success: true, data: updated.preferences });
});

const uploadAvatar = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError('An image file is required', 422);

  // Committee members can change their photo freely (see Profile.jsx's
  // isCommittee bypass — it's low-stakes for them); residents must have
  // already verified an AVATAR code via /users/me/otp/request first,
  // since a profile photo change is otherwise unauthenticated beyond the
  // session itself.
  if (req.user.role !== 'ADMIN') {
    await consumeOtp({ userId: req.user.id, type: 'AVATAR', otp: req.body.otp });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { avatarStorageKey: true },
  });

  const { avatarUrl, storageKey } = await saveAvatarFile(req.file);

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { avatarUrl, avatarStorageKey: storageKey },
    select: { avatarUrl: true },
  });

  // Best-effort cleanup of the old file, after the new one is safely
  // recorded — same ordering as receipt replacement flows in this codebase.
  if (user?.avatarStorageKey) {
    deleteAvatarFile(user.avatarStorageKey).catch(() => {});
  }

  res.json({ success: true, data: { avatarUrl: updated.avatarUrl } });
});

const deleteAvatar = catchAsync(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { avatarStorageKey: true },
  });

  await prisma.user.update({
    where: { id: req.user.id },
    data: { avatarUrl: null, avatarStorageKey: null },
  });

  if (user?.avatarStorageKey) {
    deleteAvatarFile(user.avatarStorageKey).catch(() => {});
  }

  res.json({ success: true, message: 'Avatar removed' });
});

module.exports = { updatePreferences, uploadAvatar, deleteAvatar, requestProfileOtp, verifyPhoneOtp };
