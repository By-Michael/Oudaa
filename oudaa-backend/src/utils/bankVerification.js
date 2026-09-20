// -----------------------------------------------------------------------
// Bank transaction verification.
//
// Backed by Veritas (https://veritas.et), an UNOFFICIAL third-party
// Ethiopian payment-verification service (not affiliated with any bank
// or the NBE) that reverse-engineers CBE / Telebirr receipts (Veritas
// also supports other providers, but Hivee only offers these two — see
// PaymentProvider in schema.prisma). It is more real than the old
// hardcoded stub, but it is a single-vendor dependency with no bank-level
// accountability — treat `matched: true` from it as strong evidence, not
// final proof. See selfVerifyPayment in paymentController.js for the
// name/amount cross-check safeguard layered on top of this.
//
// Config: VERITAS_API_KEY (required to do real lookups), optional
// VERITAS_API_URL (only for a self-hosted Veritas fork; defaults to the
// hosted API). If VERITAS_API_KEY is not set, this module runs in STUB
// MODE (see isStubActive/assertRealVerificationOr Warn below) so local
// dev keeps working, but that is loudly flagged in production — see
// server.js boot check and the admin Settings banner.
// -----------------------------------------------------------------------

const AppError = require('./AppError');

const VERITAS_API_URL = process.env.VERITAS_API_URL || 'https://verifyapi.leulzenebe.pro';
const VERITAS_API_KEY = process.env.VERITAS_API_KEY || '';

// True whenever we don't have a real key and would otherwise fall back to
// the old fake-always-matches behavior. Exported so server.js / the
// settings endpoint can warn loudly instead of this being silent.
function isStubActive() {
  return !VERITAS_API_KEY;
}

// Providers whose universal detection needs a secondary field alongside
// the reference. selfVerifyPayment collects these from the resident when
// their chosen bank requires it (see paymentValidators.js). Neither of
// Hivee's two supported providers (CBE, Telebirr) needs an account
// suffix — CBE is receipt-only (see selfVerifyPayment's CBE branch) and
// never reaches this check. Kept as a Set (rather than deleted outright)
// since Veritas's own /verify-<provider> contract still supports it, in
// case a provider needing it is ever reintroduced.
const PROVIDERS_NEEDING_SUFFIX = new Set([]);
// Telebirr has no bank account — Veritas cross-checks the sender's phone
// number instead of an account suffix.
const PROVIDERS_NEEDING_PHONE = new Set(['telebirr']);

/**
 * Best-effort extraction of the fields we care about out of a Veritas
 * response. Veritas's own docs type the `data` payload as `unknown` and
 * say field names/nesting differ per provider (CBE/M-Pesa are top-level,
 * Telebirr wraps in `data`, Abyssinia uses a nested success envelope) —
 * there is no single documented schema to trust blindly. So: try the
 * common field-name candidates, and treat anything we can't confidently
 * read as *missing* rather than guessing — callers must not upgrade a
 * missing field into a passed cross-check.
 */
function pickField(obj, candidates) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of candidates) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  // Some provider envelopes nest the real payload one level down
  // (e.g. Abyssinia's outer success wrapper, Telebirr's `data`).
  for (const nestKey of ['data', 'result', 'receipt', 'payload']) {
    if (obj[nestKey] && typeof obj[nestKey] === 'object') {
      const nested = pickField(obj[nestKey], candidates);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function normalizeAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const num = typeof raw === 'string' ? Number(raw.replace(/,/g, '')) : Number(raw);
  return Number.isFinite(num) ? num : null;
}

/**
 * @param {object} params
 * @param {string} params.txnId - The transaction ID the resident typed in.
 * @param {number} params.expectedAmount - The fee amount the payment should match.
 * @param {string} [params.expectedAccountNumber] - The community's receiving account.
 * @param {string} [params.provider] - Provider hint (cbe/telebirr). When
 *   omitted, Veritas's universal /verify route auto-detects.
 * @param {string} [params.suffix] - Account suffix. Not required by
 *   either provider Hivee currently supports; kept for Veritas API
 *   compatibility.
 * @param {string} [params.phoneNumber] - 251-format phone, required by Telebirr.
 * @returns {Promise<{
 *   matched: boolean,
 *   senderName: string | null,
 *   receiverName: string | null,
 *   receiverAccount: string | null,
 *   amount: number | null,
 *   date: string | null,
 *   reference: string | null,
 *   reason: string | null,
 *   raw: unknown,
 *   fieldsIncomplete: boolean,
 * }>}
 */
async function verifyBankTransaction({ txnId, expectedAmount, expectedAccountNumber, provider, suffix, phoneNumber }) {
  const id = (txnId || '').trim();

  if (!id) {
    throw new AppError('Transaction ID is required', 422);
  }
  if (id.length < 6) {
    return { matched: false, reason: 'Transaction ID looks too short to be valid.', serviceUnavailable: false };
  }

  if (isStubActive()) {
    // ---- STUB FALLBACK (no VERITAS_API_KEY configured) ----
    // Only meant for local dev without credentials. Deliberately does NOT
    // silently rubber-stamp: it always returns fieldsIncomplete so the
    // caller's cross-check safeguard routes it to PENDING_REVIEW rather
    // than instant VERIFIED, even in this fallback path.
    console.warn('[bankVerification] VERITAS_API_KEY not set — running in STUB mode. Do NOT deploy to production like this.');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const looksInvalid = /^0+$/.test(id) || id.toUpperCase() === 'INVALID';
    if (looksInvalid) {
      return { matched: false, senderName: null, receiverName: null, receiverAccount: null, amount: null, date: null, reference: id, reason: 'No transaction found with this ID.', raw: null, fieldsIncomplete: true, serviceUnavailable: false };
    }
    return { matched: true, senderName: null, receiverName: null, receiverAccount: expectedAccountNumber || null, amount: expectedAmount, date: new Date().toISOString(), reference: id, reason: null, raw: null, fieldsIncomplete: true, serviceUnavailable: false };
  }

  // ---- REAL VERITAS CALL ----
  const path = provider ? `/verify-${provider}` : '/verify';
  const body = { reference: id };
  if (suffix) body[provider === 'cbe' ? 'accountSuffix' : 'suffix'] = suffix;
  if (phoneNumber) body.phoneNumber = phoneNumber;

  // Transient network hiccups (DNS blip, brief Veritas outage, a slow
  // upstream that trips our timeout) shouldn't immediately block a
  // resident from submitting a real payment. Retry a couple of times
  // with a short backoff before surfacing a hard "service unavailable" —
  // and even then, the caller treats that differently from a genuine
  // "no such transaction" response (see serviceUnavailable below).
  const MAX_ATTEMPTS = 3;
  const TIMEOUT_MS = 8_000;
  const RETRY_DELAY_MS = 500;

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        response = await fetch(`${VERITAS_API_URL}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': VERITAS_API_KEY },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      let json;
      try {
        json = await response.json();
      } catch (parseErr) {
        // Non-JSON body (e.g. an upstream 502 HTML error page). Treat like
        // a network failure — retry rather than misreport it as "no match".
        throw new Error(`Non-JSON response (status ${response.status})`);
      }

      // Veritas docs: "Some provider adapters can return a provider failure
      // with HTTP 200" — so check the body's success flag too, not just status.
      if (!response.ok || json?.success === false) {
        // A 5xx from Veritas itself is their outage, not "not found" —
        // worth retrying. A 4xx (bad reference, validation) is final.
        if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
          console.warn(`[bankVerification] Veritas ${response.status} on attempt ${attempt}/${MAX_ATTEMPTS}, retrying…`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        return {
          matched: false,
          senderName: null, receiverName: null, receiverAccount: null, amount: null, date: null,
          reference: id,
          reason: json?.error || 'No transaction found with this ID.',
          raw: json,
          fieldsIncomplete: true,
          serviceUnavailable: false,
        };
      }

      const senderName = pickField(json, ['senderName', 'payerName', 'payer', 'senderFullName', 'sender', 'fromName']);
      const receiverName = pickField(json, ['receiverName', 'receiver', 'receiverFullName', 'toName', 'beneficiaryName']);
      const receiverAccount = pickField(json, ['receiverAccount', 'creditAccount', 'toAccount', 'accountNumber', 'beneficiaryAccount']);
      const amountRaw = pickField(json, ['amount', 'transactionAmount', 'totalAmount', 'value']);
      const date = pickField(json, ['date', 'transactionDate', 'paymentDate', 'timestamp', 'createdAt']);

      const amount = normalizeAmount(amountRaw);
      // If we couldn't read amount at all, we can't do the amount cross-check
      // downstream in good faith — flag it rather than pretend certainty.
      const fieldsIncomplete = amount === null && senderName === null;

      return {
        matched: true,
        senderName,
        receiverName,
        receiverAccount,
        amount,
        date: date || null,
        reference: id,
        reason: null,
        raw: json,
        fieldsIncomplete,
        serviceUnavailable: false,
      };
    } catch (err) {
      // Network error / timeout / non-JSON body. Retry a couple of times
      // before giving up — NEVER fall back to matched: true here either way.
      lastErr = err;
      console.error(`[bankVerification] Veritas request failed (attempt ${attempt}/${MAX_ATTEMPTS}):`, err.message);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }

  // Every attempt failed on a network/timeout/parse error. This is
  // distinct from "we asked the bank and it said no" — flag it as
  // serviceUnavailable so the caller can route the resident to a
  // PENDING_REVIEW queue instead of hard-rejecting a possibly-real payment.
  return {
    matched: false,
    senderName: null, receiverName: null, receiverAccount: null, amount: null, date: null,
    reference: id,
    reason: 'Could not reach the bank verification service after several attempts. Your payment will be submitted for manual review instead.',
    raw: null,
    fieldsIncomplete: true,
    serviceUnavailable: true,
    lastError: lastErr?.message || null,
  };
}

module.exports = { verifyBankTransaction, isStubActive, PROVIDERS_NEEDING_SUFFIX, PROVIDERS_NEEDING_PHONE };
