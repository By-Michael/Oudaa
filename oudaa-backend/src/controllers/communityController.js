const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { isStubActive } = require('../utils/bankVerification');
const { isSupabaseConfigured } = require('../config/storage');
const { createPendingChange } = require('./pendingChangeController');

const getMyCommunity = catchAsync(async (req, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.user.communityId } });
  if (!community) throw new AppError('Community not found', 404);
  // Surfaced so the admin Settings page can show a loud banner if bank
  // verification is still running as a stub (no VERITAS_API_KEY) — see
  // src/utils/bankVerification.js — or if receipt uploads are still going
  // to local disk instead of Supabase Storage (see src/config/storage.js).
  res.json({
    success: true,
    data: { ...community, bankVerificationStubActive: isStubActive(), receiptStorageStubActive: !isSupabaseConfigured },
  });
});

// Bank payment-account fields control where every resident's money gets
// sent — the most sensitive setting in the system — so they go through the
// PendingChange committee-approval flow instead of applying instantly.
// name/address/contactInfo/autoVerifyMaxAmount are lower-stakes (cosmetic,
// or an internal fraud-detection knob rather than a money destination) and
// stay instant-apply for a single ADMIN, per product decision.
const PENDING_CHANGE_FIELDS = ['paymentBankName', 'paymentAccountName', 'paymentAccountNumber'];

const updateMyCommunity = catchAsync(async (req, res) => {
  const { name, address, contactInfo, paymentBankName, paymentAccountName, paymentAccountNumber, autoVerifyMaxAmount } = req.body;

  const current = await prisma.community.findUnique({ where: { id: req.user.communityId } });
  if (!current) throw new AppError('Community not found', 404);

  const instantData = {};
  if (name !== undefined) instantData.name = name;
  if (address !== undefined) instantData.address = address;
  if (contactInfo !== undefined) instantData.contactInfo = contactInfo;
  if (autoVerifyMaxAmount !== undefined) instantData.autoVerifyMaxAmount = autoVerifyMaxAmount;

  const bankFieldsTouched = [paymentBankName, paymentAccountName, paymentAccountNumber].some((v) => v !== undefined);

  let pendingChangeResult = null;
  if (bankFieldsTouched) {
    pendingChangeResult = await createPendingChange(req, {
      changeType: 'COMMUNITY_PAYMENT_DETAILS',
      entityId: current.id,
      currentEntity: current,
      proposedFields: { paymentBankName, paymentAccountName, paymentAccountNumber },
    });
  }

  const updated = Object.keys(instantData).length > 0
    ? await prisma.community.update({ where: { id: req.user.communityId }, data: instantData })
    : current;

  res.json({
    success: true,
    data: { ...updated, ...(pendingChangeResult?.applied ? pendingChangeResult.entity : {}) },
    pendingChange: pendingChangeResult?.pending || null,
    bankDetailsMessage: bankFieldsTouched
      ? (pendingChangeResult?.pending
          ? 'Payment account changes need every other committee member to approve before they take effect.'
          : pendingChangeResult?.applied
            ? 'Payment account details updated — you\'re the only committee member, so no separate approval was needed.'
            : 'No change to the payment account details.')
      : null,
  });
});

// Public (no auth) — the login page loaded from a community's own
// subdomain (acme.oudaa.app) calls this before anyone signs in, purely to
// show that community's name instead of generic branding, and so it can
// send the slug back with the login request for the tenant safety check
// in authController.login. Deliberately returns almost nothing — a slug
// is guessable, so this must never leak anything sensitive (financials,
// resident data, bank details) to an unauthenticated caller.
const getCommunityBySlug = catchAsync(async (req, res) => {
  const community = await prisma.community.findUnique({
    where: { slug: req.params.slug },
    select: { id: true, name: true, slug: true },
  });
  if (!community) throw new AppError('Community not found', 404);
  res.json({ success: true, data: community });
});

module.exports = { getMyCommunity, updateMyCommunity, getCommunityBySlug, PENDING_CHANGE_FIELDS };
