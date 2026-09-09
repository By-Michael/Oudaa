const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { recordAudit } = require('../utils/audit');
const { verifyBankTransaction, PROVIDERS_NEEDING_SUFFIX, PROVIDERS_NEEDING_PHONE } = require('../utils/bankVerification');
const { parseReceiptImage } = require('../utils/ocrReceipt');
const { extractCbeReferenceFromReceipt, isLikelyCbeReceiptLink } = require('../utils/receiptQrExtraction');
const { saveReceiptFile } = require('../config/storage');
const { sendNotificationEmail } = require('../utils/email');

// Amount tolerance for the bank-verification cross-check — covers bank-fee
// rounding, not a loophole. Absolute birr amount, not a percentage, so it
// doesn't scale up into a meaningful gap on large payments.
const AMOUNT_TOLERANCE_BIRR = 1;

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .sort();
}

// Order-insensitive, punctuation-insensitive token overlap check — good
// enough to catch "typed a random string" or "wrong person entirely"
// without being so strict that legitimate name-order/spelling variance
// (very common with transliterated Amharic names) constantly false-flags.
// Deliberately conservative: this is a *safeguard*, not the sole judge —
// anything it's unsure about should fall to a human, not auto-pass.
function namesLikelyMatch(registeredName, bankSenderName) {
  const a = normalizeName(registeredName);
  const b = normalizeName(bankSenderName);
  if (a.length === 0 || b.length === 0) return null; // can't judge — treat as unknown, not a pass
  const overlap = a.filter((tok) => b.includes(tok)).length;
  const minLen = Math.min(a.length, b.length);
  return overlap >= Math.max(1, Math.ceil(minLen * 0.5));
}

const PAYMENT_INCLUDE = {
  fee: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  fund: { select: { id: true, name: true } },
  resident: { include: { user: { select: { fullName: true, email: true } } } },
  recorder: { select: { id: true, fullName: true } },
};

// Payment.communityId is a denormalized, indexed copy of the resident's
// community (see schema.prisma comment) — a plain equality filter instead
// of joining out through fee/project/fund on every query.
const communityPaymentFilter = (communityId) => ({ communityId });

// Fire-and-forget acknowledgement email for a resident's own self-verified
// payment submission — the resident sees the result immediately in the
// UI, but many residents pay and close the tab, so an email confirming
// what happened (auto-verified vs. queued for review) is worth sending.
// Never blocks the request; sendEmail itself never throws.
function notifyResidentOfSelfVerifyResult({ toEmail, fullName, communityName, amount, targetLabel, status, flags }) {
  if (!toEmail) return;
  const message =
    status === 'VERIFIED'
      ? `Your payment of ${amount} for ${targetLabel} was automatically verified against the bank. Thanks!`
      : `Your payment of ${amount} for ${targetLabel} has been received and is waiting on a quick manual check by the committee before it's marked verified${flags ? ` (${flags})` : ''}. You'll be notified once it's reviewed.`;
  sendNotificationEmail({
    to: toEmail,
    fullName,
    subject: status === 'VERIFIED' ? 'Your payment was verified' : 'Your payment is being reviewed',
    message,
    communityName,
  }).catch(() => {});
}

// The bank-verification response (Veritas) already captures who actually
// sent the money — it's saved wholesale in verificationRaw for admin
// review, but was never surfaced as its own field on the payment, so the
// committee had no quick way to see it next to the payer name they
// registered under. Pull it back out here (same candidate-field logic as
// bankVerification.js's pickField, since Veritas's schema isn't fixed
// across providers) rather than adding a DB column, so nothing needs a
// migration to show it.
const SENDER_NAME_CANDIDATES = ['senderName', 'payerName', 'payer', 'senderFullName', 'sender', 'fromName'];
const RECEIVER_ACCOUNT_CANDIDATES = ['receiverAccount', 'creditAccount', 'toAccount', 'accountNumber', 'beneficiaryAccount'];
function extractField(raw, candidates) {
  if (!raw || typeof raw !== 'object') return null;
  for (const key of candidates) {
    if (raw[key]) return raw[key];
  }
  for (const nestKey of ['data', 'result', 'receipt', 'payload']) {
    if (raw[nestKey] && typeof raw[nestKey] === 'object') {
      const nested = extractField(raw[nestKey], candidates);
      if (nested) return nested;
    }
  }
  return null;
}
function withSenderName(payment) {
  if (!payment) return payment;
  return {
    ...payment,
    senderName: extractField(payment.verificationRaw, SENDER_NAME_CANDIDATES),
    receiverAccount: extractField(payment.verificationRaw, RECEIVER_ACCOUNT_CANDIDATES),
  };
}

// Helper: resolve the resident record that this request is allowed to act as.
async function resolveResidentId(req) {
  if (req.user.role === 'RESIDENT') {
    const resident = await prisma.resident.findUnique({ where: { userId: req.user.id } });
    if (!resident) throw new AppError('Resident profile not found', 404);
    return resident.id;
  }
  // ADMIN recording on behalf of someone
  if (!req.body.residentId) throw new AppError('residentId is required', 422);
  const resident = await prisma.resident.findFirst({
    where: { id: req.body.residentId, communityId: req.communityId },
  });
  if (!resident) throw new AppError('Resident not found in this community', 404);
  return resident.id;
}

// Resolves + validates whichever of feeId/projectId/fundId was sent, scoped
// to the current community. Returns { feeId, projectId, fundId, label } with
// exactly one set (the validator already enforced XOR shape).
async function resolveTarget(req) {
  if (req.body.feeId) {
    const fee = await prisma.fee.findFirst({ where: { id: req.body.feeId, communityId: req.communityId } });
    if (!fee) throw new AppError('Fee not found in this community', 404);
    return { feeId: fee.id, projectId: null, fundId: null, label: `fee "${fee.name}"` };
  }
  if (req.body.projectId) {
    const project = await prisma.project.findFirst({ where: { id: req.body.projectId, communityId: req.communityId } });
    if (!project) throw new AppError('Project not found in this community', 404);
    return { feeId: null, projectId: project.id, fundId: null, label: `project "${project.name}"` };
  }
  const fund = await prisma.fund.findFirst({ where: { id: req.body.fundId, communityId: req.communityId } });
  if (!fund) throw new AppError('Fund not found in this community', 404);
  return { feeId: null, projectId: null, fundId: fund.id, label: `fund "${fund.name}"` };
}

const createPayment = catchAsync(async (req, res) => {
  const residentId = await resolveResidentId(req);
  const target = await resolveTarget(req);
  const isAdminRecording = req.user.role === 'ADMIN';

  const payment = await prisma.payment.create({
    data: {
      communityId: req.communityId,
      residentId,
      feeId: target.feeId,
      projectId: target.projectId,
      fundId: target.fundId,
      amount: req.body.amount,
      paymentMethod: req.body.paymentMethod,
      transactionReference: req.body.transactionReference,
      paidAt: req.body.paidAt,
      paidForMonth: target.feeId ? (req.body.paidForMonth || undefined) : undefined,
      // A committee member recording a payment has, by definition, already
      // received the money (cash in hand, receipt in front of them) — so
      // it's marked verified immediately instead of sitting in a PENDING
      // queue waiting for a second admin action against itself.
      status: isAdminRecording ? 'VERIFIED' : 'PENDING',
      verifiedBy: isAdminRecording ? req.user.id : null,
      recordedBy: isAdminRecording ? req.user.id : null,
    },
    include: PAYMENT_INCLUDE,
  });

  await recordAudit(req, { action: 'CREATE', entityType: 'Payment', entityId: payment.id, description: `Recorded payment of ${payment.amount} for ${target.label}` });
  res.status(201).json({ success: true, data: payment });
});

// Paginated for the same reason residents are (see residentController.js):
// with thousands of rows, returning everything unconditionally in one
// response is a multi-second, multi-megabyte request. Ordered + filtered
// on communityId/paidAt/residentId, all of which are indexed.
const listPayments = catchAsync(async (req, res) => {
  let where = communityPaymentFilter(req.communityId);

  if (req.user.role === 'RESIDENT') {
    const resident = await prisma.resident.findUnique({ where: { userId: req.user.id } });
    if (!resident) throw new AppError('Resident profile not found', 404);
    where = { AND: [where, { residentId: resident.id }] };
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 300));

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: PAYMENT_INCLUDE,
      orderBy: { paidAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payment.count({ where }),
  ]);

  res.json({
    success: true,
    data: payments.map(withSenderName),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
});

const getPayment = catchAsync(async (req, res) => {
  const payment = await prisma.payment.findFirst({
    where: {
      id: req.params.id,
      ...communityPaymentFilter(req.communityId),
    },
    include: PAYMENT_INCLUDE,
  });
  if (!payment) throw new AppError('Payment not found', 404);

  if (req.user.role === 'RESIDENT') {
    const resident = await prisma.resident.findUnique({ where: { userId: req.user.id } });
    if (!resident || payment.residentId !== resident.id) {
      throw new AppError('You do not have permission to view this payment', 403);
    }
  }

  res.json({ success: true, data: withSenderName(payment) });
});

// ADMIN verifies or rejects a payment.
const updatePaymentStatus = catchAsync(async (req, res) => {
  const payment = await prisma.payment.findFirst({
    where: { id: req.params.id, ...communityPaymentFilter(req.communityId) },
  });
  if (!payment) throw new AppError('Payment not found', 404);

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: req.body.status, verifiedBy: req.user.id },
    include: PAYMENT_INCLUDE,
  });

  // Fire-and-forget: sendEmail never throws (see utils/email.js), and the
  // status change itself must not be blocked/delayed by email latency.
  // Only VERIFIED/REJECTED are terminal, user-meaningful outcomes worth
  // emailing about — leaving something at PENDING isn't news.
  if ((req.body.status === 'VERIFIED' || req.body.status === 'REJECTED') && updated.resident?.user?.email) {
    const forLabel = updated.fee?.name || updated.project?.name || updated.fund?.name || 'your payment';
    const community = await prisma.community.findUnique({ where: { id: req.communityId }, select: { name: true } });
    const message =
      req.body.status === 'VERIFIED'
        ? `Your payment of ${updated.amount} for "${forLabel}" has been verified by the committee.`
        : `Your payment of ${updated.amount} for "${forLabel}" was reviewed and could not be verified. Please contact the committee if you believe this is a mistake, or submit a corrected payment.`;
    sendNotificationEmail({
      to: updated.resident.user.email,
      fullName: updated.resident.user.fullName,
      subject: req.body.status === 'VERIFIED' ? 'Your payment was verified' : 'Your payment was not verified',
      message,
      communityName: community?.name,
    }).catch(() => {});
  }

  await recordAudit(req, {
    action: req.body.status === 'VERIFIED' ? 'VERIFY' : req.body.status === 'REJECTED' ? 'REJECT' : 'UPDATE',
    entityType: 'Payment',
    entityId: payment.id,
    description: `Marked payment ${payment.id.slice(0, 8)} as ${req.body.status}`,
  });

  res.json({ success: true, data: updated });
});

// ADMIN edits a payment they (or a fellow committee member) typed in
// manually. Deliberately restricted to payments with recordedBy set — a
// resident's own bank-verified payment is never editable here, since the
// verified bank transaction is the source of truth for that record, not
// whatever a committee member might type into this form afterwards.
const updatePayment = catchAsync(async (req, res) => {
  const payment = await prisma.payment.findFirst({
    where: { id: req.params.id, ...communityPaymentFilter(req.communityId) },
  });
  if (!payment) throw new AppError('Payment not found', 404);
  if (!payment.recordedBy) {
    throw new AppError('Only manually-recorded payments can be edited. This one was self-verified by the resident.', 403);
  }

  const data = {};
  if (req.body.amount !== undefined) data.amount = req.body.amount;
  if (req.body.paymentMethod !== undefined) data.paymentMethod = req.body.paymentMethod;
  if (req.body.transactionReference !== undefined) data.transactionReference = req.body.transactionReference;
  if (req.body.paidAt !== undefined) data.paidAt = req.body.paidAt;
  if (req.body.feeId || req.body.projectId || req.body.fundId) {
    const target = await resolveTarget(req);
    data.feeId = target.feeId;
    data.projectId = target.projectId;
    data.fundId = target.fundId;
  }

  const updated = await prisma.payment.update({ where: { id: payment.id }, data, include: PAYMENT_INCLUDE });

  await recordAudit(req, { action: 'UPDATE', entityType: 'Payment', entityId: payment.id, description: `Edited manually-recorded payment ${payment.id.slice(0, 8)}` });
  res.json({ success: true, data: updated });
});

// ADMIN deletes a payment they (or a fellow committee member) typed in
// manually — same recordedBy restriction as updatePayment, and for the
// same reason. This is an intentional, narrow exception to "payments are
// append-only": a manual entry is corrected the same way any human data-
// entry mistake is, and the full record is preserved in the audit log
// (metadata snapshot) even after the row itself is gone.
const deletePayment = catchAsync(async (req, res) => {
  const payment = await prisma.payment.findFirst({
    where: { id: req.params.id, ...communityPaymentFilter(req.communityId) },
    include: PAYMENT_INCLUDE,
  });
  if (!payment) throw new AppError('Payment not found', 404);
  if (!payment.recordedBy) {
    throw new AppError('Only manually-recorded payments can be deleted. This one was self-verified by the resident.', 403);
  }

  await prisma.payment.delete({ where: { id: payment.id } });

  await recordAudit(req, {
    action: 'DELETE',
    entityType: 'Payment',
    entityId: payment.id,
    description: `Deleted manually-recorded payment of ${payment.amount} for ${payment.resident?.user?.fullName || 'a resident'}`,
    metadata: {
      amount: payment.amount,
      residentId: payment.residentId,
      feeId: payment.feeId,
      projectId: payment.projectId,
      fundId: payment.fundId,
      paymentMethod: payment.paymentMethod,
      transactionReference: payment.transactionReference,
      paidAt: payment.paidAt,
    },
  });

  res.json({ success: true, message: 'Payment deleted' });
});

// Attach/replace the receipt photo on a manually-recorded payment. Kept as
// a separate call (like expense receipts) so the record can be created
// fast and the (larger) file upload doesn't block that.
const uploadPaymentReceipt = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError('Receipt file is required', 422);

  const payment = await prisma.payment.findFirst({
    where: { id: req.params.id, ...communityPaymentFilter(req.communityId) },
  });
  if (!payment) throw new AppError('Payment not found', 404);
  if (!payment.recordedBy) {
    throw new AppError('Receipts can only be attached to manually-recorded payments', 403);
  }

  const { fileUrl } = await saveReceiptFile(req.file);
  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { receiptUrl: fileUrl },
    include: PAYMENT_INCLUDE,
  });

  res.json({ success: true, data: updated });
});

// Resident self-serve: upload a CBE e-receipt (screenshot or PDF) *before*
// calling self-verify, and get back a URL to send as `receiptUrl`. Kept as
// its own multipart endpoint (like uploadPaymentReceipt above) rather than
// folded into self-verify itself, so self-verify can stay a plain JSON
// endpoint — every other provider never touches a file at all.
const uploadSelfPaymentReceipt = catchAsync(async (req, res) => {
  if (req.user.role !== 'RESIDENT') {
    throw new AppError('Only residents can upload a self-payment receipt', 403);
  }
  if (!req.file) throw new AppError('Receipt file is required', 422);

  const { fileUrl } = await saveReceiptFile(req.file);

  // Best-effort: try to pull the transaction reference straight off the
  // receipt (QR code) so a CBE payment can eventually skip PENDING_REVIEW
  // the same way other providers do. Stubbed today — see module header —
  // so this always comes back null until that's implemented, and
  // selfVerifyPayment already treats a missing reference as "queue for
  // manual review", not an error.
  const extracted = await extractCbeReferenceFromReceipt({
    fileBuffer: req.file.buffer,
    mimetype: req.file.mimetype,
  }).catch(() => ({ reference: null, suffix: null }));

  res.json({ success: true, data: { receiptUrl: fileUrl, extractedReference: extracted.reference } });
});

// Map a CommunityPaymentMethod's PaymentProvider enum (schema.prisma, DB
// value) to the lowercase provider hint bankVerification.js expects.
// Hivee only supports these two providers (see PaymentProvider enum).
const DB_PROVIDER_TO_VERITAS = {
  CBE: 'cbe',
  TELEBIRR: 'telebirr',
};

// Resolves which payment method the resident is paying through, and what
// provider/expected-account that implies. Falls back to the community's
// single legacy account (community.paymentAccountNumber, no provider
// hint — universal auto-detect) for communities that haven't added any
// CommunityPaymentMethod rows yet, so nothing breaks for them.
async function resolvePaymentMethod(req, community) {
  const { paymentMethodId, provider: rawProvider } = req.body;

  if (paymentMethodId) {
    const method = await prisma.communityPaymentMethod.findFirst({
      where: { id: paymentMethodId, communityId: req.communityId, isActive: true },
    });
    if (!method) throw new AppError('Selected payment method is not available', 404);
    return {
      method,
      provider: DB_PROVIDER_TO_VERITAS[method.provider],
      expectedAccountNumber: method.accountNumber || undefined,
    };
  }

  // Backward-compat path: no payment methods configured yet, resident's
  // client sent a bare `provider` string against the single legacy account.
  return {
    method: null,
    provider: rawProvider,
    expectedAccountNumber: community?.paymentAccountNumber,
  };
}

// Resident self-serve flow: submit a bank txn ID + the name it was sent
// under, and get verified against the bank instantly instead of waiting
// on an admin. Required fields are txnId + payerName plus exactly one of
// feeId (pay a fee) or fundId (free-form contribution to a fund, any
// amount of the resident's choosing — no "usual amount" involved).
//
// Provider-specific shape (see resolvePaymentMethod / CommunityPaymentMethod):
//   - CBE: no txnId, no suffix. The resident instead uploads a receipt
//     (POST /payments/self-verify/receipt first, or pastes a link) —
//     `receiptUrl` is required instead. Without a bank-verifiable
//     reference this always lands in PENDING_REVIEW today (see the CBE
//     branch below) until QR extraction is wired up.
//   - TELEBIRR: txnId (the reference number) + phoneNumber (the sender's
//     phone) — Telebirr has no account to cross-check against.
//   - legacy single-account communities (no CommunityPaymentMethod rows
//     yet): the existing txnId flow, no provider hint.
const selfVerifyPayment = catchAsync(async (req, res) => {
  if (req.user.role !== 'RESIDENT') {
    throw new AppError('Only residents can submit self-verified payments', 403);
  }

  const { feeId, fundId, txnId, payerName, reason, suffix, phoneNumber, receiptAmount, receiptUrl } = req.body;
  if (!feeId && !fundId) throw new AppError('feeId or fundId is required', 422);
  if (feeId && fundId) throw new AppError('Provide exactly one of feeId or fundId', 422);
  if (!payerName || !payerName.trim()) throw new AppError('Payer name is required', 422);

  const resident = await prisma.resident.findUnique({
    where: { userId: req.user.id },
    include: { user: { select: { fullName: true } } },
  });
  if (!resident) throw new AppError('Resident profile not found', 404);

  const community = await prisma.community.findUnique({ where: { id: req.communityId } });
  const { method: paymentMethod, provider, expectedAccountNumber } = await resolvePaymentMethod(req, community);
  const isCbe = provider === 'cbe';

  if (!isCbe) {
    if (!txnId || !txnId.trim()) throw new AppError('Transaction ID is required', 422);
    if (provider && PROVIDERS_NEEDING_SUFFIX.has(provider) && !suffix) {
      throw new AppError('This bank requires the account suffix shown on your receipt', 422);
    }
    if (provider && PROVIDERS_NEEDING_PHONE.has(provider) && !phoneNumber) {
      throw new AppError('This provider requires the phone number the payment was made from', 422);
    }
  } else if (!receiptUrl) {
    throw new AppError('Upload a receipt (screenshot, PDF, or link) for CBE payments', 422);
  }

  let fee = null;
  let fund = null;
  let amount;

  if (feeId) {
    fee = await prisma.fee.findFirst({ where: { id: feeId, communityId: req.communityId } });
    if (!fee) throw new AppError('Fee not found in this community', 404);

    // A resident can pay more than the fee's usual amount (e.g. topping up
    // a fund) but never less — an underpayment isn't a valid settlement of
    // the fee, it'd just create confusing partial-payment bookkeeping.
    amount = Number(fee.amount);
    if (req.body.amount !== undefined) {
      if (req.body.amount < Number(fee.amount)) {
        throw new AppError(`Amount can't be less than ${fee.amount} for this fee`, 422);
      }
      amount = req.body.amount;
    }
  } else {
    fund = await prisma.fund.findFirst({ where: { id: fundId, communityId: req.communityId } });
    if (!fund) throw new AppError('Fund not found in this community', 404);

    // A direct fund contribution has no fee to anchor an amount to — the
    // resident picks whatever they want to give, as long as it's positive.
    if (req.body.amount === undefined) throw new AppError('amount is required to contribute to a fund', 422);
    if (req.body.amount <= 0) throw new AppError('amount must be greater than 0', 422);
    amount = req.body.amount;
  }

  // A transaction ID can only ever pay for one fee — block reuse (typo'd
  // resubmits are fine since they'll get a fresh ID, but the same real
  // transfer can't be used to "pay" twice). CBE has no txnId at this
  // point (receipt-only), so this check simply doesn't apply to it yet —
  // once QR extraction is wired up and yields a real reference, the same
  // dedup should run against that instead.
  if (!isCbe) {
    const alreadyUsed = await prisma.payment.findFirst({
      where: {
        transactionReference: txnId.trim(),
        ...communityPaymentFilter(req.communityId),
        status: { not: 'REJECTED' },
      },
      include: PAYMENT_INCLUDE,
    });
    if (alreadyUsed) {
      // Bank verification below can take up to ~25s (3 retries x 8s
      // timeout). If the client's connection drops before the response
      // arrives, the request has already completed server-side by the time
      // the resident sees a "network error" and retries — so a same-resident
      // resubmit of the exact txnId is very likely their own earlier attempt
      // succeeding invisibly, not a real double-submission. Return that
      // existing payment instead of a scary 409 in that case; a *different*
      // resident reusing someone else's transaction ID is the case we
      // actually need to block hard.
      if (alreadyUsed.residentId === resident.id) {
        return res.json({ success: true, data: alreadyUsed, idempotentReplay: true });
      }
      throw new AppError('This transaction ID has already been used for a payment', 409);
    }
  }

  const targetLabel = fee ? `fee "${fee.name}"` : `fund "${fund.name}"`;

  // ---- CBE branch ----
  // CBE dropped the old FT-reference + account-suffix scheme, so the
  // resident never types a bank transaction ID for it. Instead we try to
  // resolve a Veritas-verifiable reference from whatever they gave us —
  // a pasted receipt link, or the QR code decoded off an uploaded
  // screenshot/PDF (see receiptQrExtraction.js) — and, when we get one,
  // verify it exactly like any other provider (shared logic below).
  // Only when no reference could be resolved (QR unreadable, resident
  // uploaded something without a QR, etc.) do we fall back to the old
  // "queue for manual review" behavior.
  let cbeReference = null;
  if (isCbe) {
    if (req.body.receiptReference && req.body.receiptReference.trim()) {
      cbeReference = req.body.receiptReference.trim();
    } else if (isLikelyCbeReceiptLink(receiptUrl)) {
      // The resident pasted the CBE receipt link directly as receiptUrl
      // (rather than uploading a file) — that link IS the reference.
      cbeReference = receiptUrl.trim();
    } else {
      // Last resort: if a file was uploaded, its receiptUrl is our own
      // storage URL, not a CBE link — try decoding the QR straight off
      // that stored file so a client that skipped the
      // /self-verify/receipt prefill step doesn't lose out.
      const extracted = await extractCbeReferenceFromReceipt({ receiptLink: receiptUrl }).catch(() => null);
      if (extracted?.reference) cbeReference = extracted.reference;
    }
  }

  if (isCbe && !cbeReference) {
    const payment = await prisma.payment.create({
      data: {
        communityId: req.communityId,
        residentId: resident.id,
        feeId: fee ? fee.id : undefined,
        fundId: fund ? fund.id : undefined,
        amount,
        paymentMethod: 'MOBILE_MONEY',
        paymentMethodId: paymentMethod?.id,
        transactionReference: null,
        payerName: payerName.trim(),
        reason: reason?.trim() || undefined,
        status: 'PENDING_REVIEW',
        receiptUrl,
        verificationRaw: null,
        reviewFlags: 'CBE receipt uploaded — could not automatically read a QR reference off it, needs manual review against the receipt.',
      },
      include: PAYMENT_INCLUDE,
    });
    await recordAudit(req, {
      action: 'CREATE',
      entityType: 'Payment',
      entityId: payment.id,
      description: `Self-verified CBE payment (${amount}) for ${targetLabel} — pending manual review (no QR reference found)`,
    });
    notifyResidentOfSelfVerifyResult({
      toEmail: req.user.email,
      fullName: req.user.fullName,
      communityName: community?.name,
      amount,
      targetLabel,
      status: 'PENDING_REVIEW',
      flags: 'receipt needs manual review',
    });
    return res.json({ success: true, data: withSenderName(payment) });
  }

  // From here on, CBE-with-a-resolved-reference and every other provider
  // share the exact same verify → cross-check → create flow. `txnId` is
  // used purely as the effective reference from this point down (the
  // dedupe check and the stored `transactionReference` both need it).
  const effectiveTxnId = isCbe ? cbeReference : txnId.trim();

  // A transaction ID/reference can only ever pay for one fee — block
  // reuse the same way for CBE as every other provider now that CBE has
  // a real reference to dedupe against.
  if (isCbe) {
    const alreadyUsed = await prisma.payment.findFirst({
      where: {
        transactionReference: effectiveTxnId,
        ...communityPaymentFilter(req.communityId),
        status: { not: 'REJECTED' },
      },
      include: PAYMENT_INCLUDE,
    });
    if (alreadyUsed) {
      if (alreadyUsed.residentId === resident.id) {
        return res.json({ success: true, data: alreadyUsed, idempotentReplay: true });
      }
      throw new AppError('This CBE receipt has already been used for a payment', 409);
    }
  }

  const result = await verifyBankTransaction({
    txnId: effectiveTxnId,
    expectedAmount: amount,
    expectedAccountNumber,
    provider,
    suffix,
    phoneNumber,
  });

  // A genuine "we asked the bank and it said no" (bad/invalid transaction
  // ID, too-short reference, etc.) is a real rejection — the resident
  // typed something wrong and should fix it before resubmitting.
  //
  // A `serviceUnavailable` result is different: Veritas itself couldn't be
  // reached after retrying, so we have no evidence either way. Blocking
  // the resident here would mean a real transfer can't be recorded just
  // because a third-party lookup service is having an outage. Instead we
  // fall through and queue it for manual admin review, same as any other
  // safeguard flag below.
  //
  // CBE is the one exception to the hard-reject: if Veritas concretely
  // says the QR-decoded reference doesn't match anything, that's much
  // more likely a QR mis-decode than the resident having typed something
  // wrong (they never typed anything) — so a CBE non-match still queues
  // for manual review against the uploaded receipt instead of blocking
  // the submission outright.
  if (!result.matched && !result.serviceUnavailable && !isCbe) {
    throw new AppError(result.reason || 'Could not verify this transaction. Double-check the ID and try again.', 422);
  }

  // ---- Safeguard layer: a bank "match" alone doesn't auto-VERIFY. ----
  // Anything the checks below can't positively clear drops to
  // PENDING_REVIEW instead of VERIFIED — an admin still needs to look,
  // but the resident isn't blocked from submitting (avoids just pushing
  // people toward typing more plausible-looking fake IDs to get past a
  // hard rejection).
  const flags = [];

  if (isCbe && !result.matched) {
    flags.push(result.reason || 'Could not verify the CBE receipt reference automatically — needs manual review.');
  }

  if (result.serviceUnavailable) {
    flags.push('Bank verification service was unreachable — this payment could not be automatically checked and needs manual review.');
  }

  if (result.fieldsIncomplete && !result.serviceUnavailable) {
    flags.push('Bank response did not include enough detail to cross-check automatically.');
  }

  if (result.amount !== null && result.amount !== undefined) {
    const diff = Math.abs(Number(result.amount) - Number(amount));
    if (diff > AMOUNT_TOLERANCE_BIRR) {
      flags.push(`Bank-reported amount (${result.amount}) differs from expected (${amount}) by more than ${AMOUNT_TOLERANCE_BIRR} birr.`);
    }
  }

  if (result.senderName) {
    const nameOk = namesLikelyMatch(resident.user?.fullName, result.senderName);
    if (nameOk === false) {
      flags.push(`Bank sender name ("${result.senderName}") doesn't look like the resident's registered name.`);
    }
    // nameOk === null (couldn't judge) intentionally doesn't add a flag on
    // its own — fieldsIncomplete already covers "couldn't cross-check".
  }

  // The resident's uploaded receipt screenshot was OCR'd client-side and
  // may have surfaced an amount (see parsePaymentScreenshot). If it's
  // present and disagrees with what they actually typed/submitted, that's
  // a real discrepancy worth a human's eyes — e.g. uploading a receipt for
  // a different, smaller transfer than the amount entered — regardless of
  // whether the bank lookup itself came back "matched". This is on top of,
  // not instead of, the result.amount cross-check above.
  if (receiptAmount !== undefined && receiptAmount !== null) {
    const receiptDiff = Math.abs(Number(receiptAmount) - Number(amount));
    if (receiptDiff > AMOUNT_TOLERANCE_BIRR) {
      flags.push(`Uploaded receipt appears to show ${receiptAmount}, which doesn't match the submitted amount (${amount}) — please verify before approving.`);
    }
  }

  if (result.receiverAccount && expectedAccountNumber && result.receiverAccount !== expectedAccountNumber) {
    // Before treating a receiving-account mismatch as suspicious, check
    // whether it matches an account the community used to pay into
    // *before* a bank-details change (see CommunityBankAccountHistory /
    // pendingChanges.js apply()) — a resident sending to an account that
    // was genuinely correct at some point isn't the same signal as one
    // sent to a random/wrong account. Only applies to the legacy single-
    // account history table, so this lookup is most meaningful when
    // paying against that fallback account rather than a specific
    // CommunityPaymentMethod (which doesn't have its own history table).
    const historicalAccount = await prisma.communityBankAccountHistory.findFirst({
      where: { communityId: req.communityId, accountNumber: result.receiverAccount },
      orderBy: { replacedAt: 'desc' },
    });
    if (historicalAccount) {
      flags.push(`Bank-reported receiving account matches a PREVIOUS community account (${historicalAccount.bankName || 'bank'}, replaced ${historicalAccount.replacedAt.toDateString()}), not the current one — likely fine if this payment predates the switch, but worth a quick look.`);
    } else {
      flags.push('Bank-reported receiving account does not match the community\'s registered account.');
    }
  }

  const threshold = community?.autoVerifyMaxAmount ? Number(community.autoVerifyMaxAmount) : null;
  if (threshold !== null && amount >= threshold) {
    flags.push(`Payment amount (${amount}) is at/above the auto-verify review threshold (${threshold}).`);
  }

  const status = flags.length > 0 ? 'PENDING_REVIEW' : 'VERIFIED';

  const payment = await prisma.payment.create({
    data: {
      communityId: req.communityId,
      residentId: resident.id,
      feeId: fee ? fee.id : undefined,
      fundId: fund ? fund.id : undefined,
      amount,
      paymentMethod: isCbe || provider === 'telebirr' ? 'MOBILE_MONEY' : 'BANK_TRANSFER',
      paymentMethodId: paymentMethod?.id,
      transactionReference: effectiveTxnId,
      payerName: payerName.trim(),
      reason: reason?.trim() || undefined,
      // Self-service payments always cover the month they're made in — no
      // catch-up/prepayment picking happens on this flow (that's admin-only,
      // see createPayment), so just tag it with today's month for fee
      // payments so the resident's own history can show "for" a month.
      paidForMonth: fee ? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}` : undefined,
      status,
      receiptUrl: isCbe ? receiptUrl : undefined,
      verificationRaw: result.raw ?? undefined,
      reviewFlags: flags.length > 0 ? flags.join(' ') : undefined,
    },
    include: PAYMENT_INCLUDE,
  });

  await recordAudit(req, {
    action: status === 'VERIFIED' ? 'VERIFY' : 'UPDATE',
    entityType: 'Payment',
    entityId: payment.id,
    description: status === 'VERIFIED'
      ? `Auto-verified payment of ${payment.amount} for ${targetLabel} via bank transaction lookup`
      : `Self-verified payment of ${payment.amount} for ${targetLabel} flagged for admin review: ${flags.join(' ')}`,
  });

  notifyResidentOfSelfVerifyResult({
    toEmail: req.user.email,
    fullName: req.user.fullName,
    communityName: community?.name,
    amount: payment.amount,
    targetLabel,
    status,
    flags: flags.length > 0 ? flags.join(' ') : null,
  });

  res.status(201).json({ success: true, data: payment });
});

// Best-effort autofill: OCR the uploaded screenshot, then let an LLM
// (Groq) turn that raw text into structured fields. Never trusted
// directly — the resident still sees and can correct every field before
// submitting, and nothing here is used for bank verification.
const parsePaymentScreenshot = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError('Screenshot file is required', 422);
  const { txnId, name, amount, bankName, date, source, rawText } =
    await parseReceiptImage(req.file.buffer, req.file.mimetype, req.file.originalname);
  res.json({ success: true, data: { txnId, name, amount, bankName, date, source, rawText } });
});

// RESIDENT retracts their own self-verified payment while it's still
// PENDING_REVIEW — i.e. before any admin has acted on it, and before it
// was ever auto-VERIFIED by the bank lookup. This covers the "I typed the
// wrong txn ID / picked the wrong fee" case: since nothing has accepted
// this payment as real yet (no admin decision, no clean auto-verify), the
// resident retracting it isn't rewriting settled financial history — it's
// withdrawing a claim nobody has confirmed. Once it's VERIFIED or an admin
// has moved it to VERIFIED/REJECTED, this is no longer allowed; from that
// point it falls under the same append-only rule as any other payment.
const retractOwnPayment = catchAsync(async (req, res) => {
  if (req.user.role !== 'RESIDENT') {
    throw new AppError('Only the resident who submitted a payment can retract it', 403);
  }

  const resident = await prisma.resident.findUnique({ where: { userId: req.user.id } });
  if (!resident) throw new AppError('Resident profile not found', 404);

  const payment = await prisma.payment.findFirst({
    where: { id: req.params.id, ...communityPaymentFilter(req.communityId) },
    include: PAYMENT_INCLUDE,
  });
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.residentId !== resident.id) {
    throw new AppError('You can only retract your own payments', 403);
  }
  if (payment.status !== 'PENDING_REVIEW') {
    throw new AppError(
      payment.status === 'VERIFIED'
        ? 'This payment has already been verified and can no longer be retracted.'
        : 'This payment has already been reviewed by an admin and can no longer be retracted.',
      409
    );
  }

  await prisma.payment.delete({ where: { id: payment.id } });

  await recordAudit(req, {
    action: 'DELETE',
    entityType: 'Payment',
    entityId: payment.id,
    description: `Resident retracted their own pending payment of ${payment.amount} for fee "${payment.fee?.name || ''}" (txn ${payment.transactionReference})`,
    metadata: {
      amount: payment.amount,
      residentId: payment.residentId,
      feeId: payment.feeId,
      transactionReference: payment.transactionReference,
      reviewFlags: payment.reviewFlags,
    },
  });

  res.json({ success: true, message: 'Payment retracted' });
});

module.exports = {
  createPayment,
  listPayments,
  getPayment,
  updatePaymentStatus,
  updatePayment,
  deletePayment,
  uploadPaymentReceipt,
  uploadSelfPaymentReceipt,
  selfVerifyPayment,
  parsePaymentScreenshot,
  retractOwnPayment,
};
