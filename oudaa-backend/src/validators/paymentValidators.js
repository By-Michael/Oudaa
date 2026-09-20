const { z } = require('zod');

// A payment is for exactly one of a fee, a project, or a fund directly —
// never zero, never more than one. Encoded as a .refine() here since
// Prisma/Postgres can't express an XOR constraint across three nullable FK
// columns.
const oneTarget = (body) => [!!body.feeId, !!body.projectId, !!body.fundId].filter(Boolean).length === 1;
const oneTargetMessage = { message: 'Provide exactly one of feeId, projectId, or fundId', path: ['feeId'] };

const createPaymentSchema = z.object({
  body: z.object({
    residentId: z.string().uuid().optional(), // ADMIN may record on behalf of a resident
    feeId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    fundId: z.string().uuid().optional(),
    amount: z.number().positive(),
    paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD', 'OTHER']).optional(),
    transactionReference: z.string().optional(),
    paidAt: z.coerce.date().optional(),
    // Which calendar month(s) this fee payment counts toward — e.g.
    // "2026-08", or "2026-06,2026-07,2026-08" when a committee member is
    // catching a resident up on several unpaid months at once. Only
    // meaningful for feeId payments; ignored otherwise.
    paidForMonth: z.string().regex(/^\d{4}-\d{2}(,\d{4}-\d{2})*$/).optional(),
  }).refine(oneTarget, oneTargetMessage),
});

// ADMIN editing a payment they (or a fellow committee member) recorded
// manually. Every field optional — only what changed needs to be sent —
// but feeId/projectId/fundId must still resolve to exactly one target if
// any of the three is touched.
const updatePaymentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    feeId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    fundId: z.string().uuid().optional(),
    amount: z.number().positive().optional(),
    paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD', 'OTHER']).optional(),
    transactionReference: z.string().optional(),
    paidAt: z.coerce.date().optional(),
    paidForMonth: z.string().regex(/^\d{4}-\d{2}(,\d{4}-\d{2})*$/).optional(),
  }).refine((body) => {
    if (!body.feeId && !body.projectId && !body.fundId) return true; // none touched — fine
    return oneTarget(body);
  }, oneTargetMessage),
});

const updatePaymentStatusSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    status: z.enum(['PENDING', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED']),
  }),
});

const idParamSchema = z.object({ params: z.object({ id: z.string().uuid() }) });

const selfVerifyPaymentSchema = z.object({
  body: z.object({
    // Exactly one of feeId or fundId — feeId for "pay a fee", fundId for a
    // free-standing "contribute whatever amount to this fund" payment
    // (Community Funds page). Enforced by the .refine() below.
    feeId: z.string().uuid().optional(),
    fundId: z.string().uuid().optional(),
    // Which of the community's configured payment methods (see
    // CommunityPaymentMethod) the resident is paying through. Optional
    // for backward compatibility with communities that haven't added any
    // yet (falls back to the single community.paymentAccountNumber) —
    // see resolvePaymentMethod in paymentController.js.
    paymentMethodId: z.string().uuid().optional(),
    // Required for every provider except CBE, which is receipt-only (see
    // the refine below and the CBE branch in the controller).
    txnId: z.string().optional(),
    payerName: z.string().min(1),
    reason: z.string().optional(),
    // Optional for feeId (defaults to the fee's amount, must be >= it —
    // enforced in the controller). Required for fundId — a direct fund
    // contribution has no "usual amount" to fall back to.
    amount: z.number().positive().optional(),
    // Which bank/provider the receipt is from — lets Veritas skip
    // auto-detection and lets us know which secondary field to require.
    // The frontend should always send this (lowercased from whichever
    // CommunityPaymentMethod.provider was selected) even when
    // paymentMethodId is also present — the validator's CBE/txnId/
    // receiptUrl refines below run on this field, before the controller
    // ever loads the payment method row to double check it server-side.
    provider: z.enum(['cbe', 'telebirr']).optional(),
    // Not required by either supported provider today (legacy CBE FT-ref
    // suffixes are no longer collected from residents — see the CBE
    // branch below); kept optional for Veritas API compatibility.
    suffix: z.string().optional(),
    // Required by Telebirr, format 251XXXXXXXXX.
    phoneNumber: z.string().optional(),
    // CBE only: URL of the e-receipt — either uploaded via
    // POST /payments/self-verify/receipt (screenshot/PDF, returns this
    // URL) or a link the resident pasted directly. Both are just URLs by
    // the time they reach this endpoint, so one field covers either path.
    receiptUrl: z.string().trim().url().optional(),
    // CBE only: the CBE receipt reference the server already resolved —
    // either the link the resident pasted, or the payload decoded off the
    // QR code on their uploaded screenshot/PDF (see
    // POST /payments/self-verify/receipt's `extractedReference` response
    // and receiptQrExtraction.js). Optional: a resident who uploaded a
    // receipt the QR decoder couldn't read still gets queued for manual
    // review rather than blocked, same as before this existed.
    receiptReference: z.string().trim().optional(),
    // Best-effort amount OCR'd off the receipt screenshot the resident
    // uploaded (see parsePaymentScreenshot). Purely a client-side signal —
    // never trusted as proof by itself — but if it disagrees with the
    // amount the resident actually typed/submitted, that's worth flagging
    // for admin review rather than silently ignoring (see selfVerifyPayment).
    // The frontend always sends this key (initialized as useState(null)),
    // sending an explicit `null` whenever OCR/Groq extraction didn't find
    // an amount — which is a valid, expected outcome (blurry receipt,
    // regex-only fallback, Groq unreachable), not a validation error.
    // z.optional() alone only tolerates a missing key, not an explicit
    // null, so without .nullable() every submission where extraction came
    // up empty was rejected outright with "expected number, received
    // null". .nullable() accepts null and we normalize it to undefined so
    // downstream code (controller's `!== undefined && !== null` check)
    // doesn't need to change.
    receiptAmount: z.number().positive().nullable().optional().transform((v) => v ?? undefined),
  }).refine((body) => [!!body.feeId, !!body.fundId].filter(Boolean).length === 1, {
    message: 'Provide exactly one of feeId or fundId',
    path: ['feeId'],
  }).refine((body) => !body.fundId || body.amount !== undefined, {
    message: 'amount is required when contributing directly to a fund',
    path: ['amount'],
  }).refine((body) => body.provider === 'cbe' || (!!body.txnId && !!body.txnId.trim()), {
    message: 'Transaction ID is required',
    path: ['txnId'],
  }).refine((body) => body.provider !== 'cbe' || !!body.receiptUrl, {
    message: 'Upload a receipt (screenshot, PDF, or link) for CBE payments',
    path: ['receiptUrl'],
  }),
});

module.exports = {
  createPaymentSchema,
  updatePaymentSchema,
  updatePaymentStatusSchema,
  idParamSchema,
  selfVerifyPaymentSchema,
};
