// -----------------------------------------------------------------------
// Screenshot autofill: sends the uploaded payment screenshot to OCR.space
// to get raw text, then to Groq (an LLM) to turn that raw, messy text into
// structured fields. OCR.space alone only returns a flat text blob with no
// concept of "this number is the amount vs. this is the txn ID" — regex
// heuristics over that text are brittle across the many different bank
// receipt layouts. Groq is asked to read the OCR text and *classify* which
// substrings are which field, given the fields already found by regex as a
// hint. It is NOT given the image — it never re-does OCR, it only
// interprets text OCR already extracted, so a bad OCR read stays a bad OCR
// read either way; this step only helps when the raw text is decent but
// unstructured.
// Treat all of this as a prefill suggestion, never ground truth — the
// resident still sees and can correct every field, and the caller
// (paymentController) never trusts txnId/amount for verification purposes
// without the bank lookup in bankVerification.js.
// -----------------------------------------------------------------------

const AppError = require('../utils/AppError');
const { extractReceiptFields, extractReceiptFieldsFromImage } = require('./groqReceiptParser');

const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';

async function ocrSpaceParse(fileBuffer, mimetype, filename) {
  const apiKey = process.env.OCRSPACE_API_KEY;
  if (!apiKey) {
    throw new AppError('OCR is not configured on the server (missing OCRSPACE_API_KEY)', 500);
  }

  const form = new FormData();
  form.append('apikey', apiKey);
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'false');
  form.append('OCREngine', '2');
  form.append('scale', 'true');
  form.append('file', new Blob([fileBuffer], { type: mimetype }), filename || 'receipt.jpg');

  const res = await fetch(OCR_SPACE_URL, { method: 'POST', body: form });
  if (!res.ok) {
    // Log the actual reason so a 502 here is diagnosable instead of a black
    // box — OCR.space returns a JSON or plain-text error body on failure
    // (bad/missing API key, rate limit, file too large, unsupported format).
    const bodyText = await res.text().catch(() => '');
    console.error(`[ocrReceipt] OCR.space request failed (${res.status}): ${bodyText.slice(0, 300)}`);
    throw new AppError('OCR service request failed', 502);
  }
  const data = await res.json();

  if (data.IsErroredOnProcessing) {
    throw new AppError(
      Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join('; ') : data.ErrorMessage || 'OCR failed to read this image',
      422
    );
  }

  const text = (data.ParsedResults || []).map((r) => r.ParsedText).join('\n');
  return text || '';
}

// ---- heuristic extraction over the raw OCR text ----

// Priority 1: labeled field (Txn ID, Reference, FT No, etc.). The
// captured value must contain at least one digit — real references/FT
// numbers always do, but the loose version of this pattern used to also
// grab any plain English word sitting right after the label (no colon
// required between them), e.g. "Transaction" followed by an unrelated UI
// label like "Action Required" would capture "Action" as the txnId.
const TXN_LABEL_RE = /(?:txn|transaction|trans(?:fer)?|reference|ref(?:\s*no)?|ft\s*(?:no|#)?)\s*[:-]?\s*((?=[A-Z0-9-]*[0-9])[A-Z0-9-]{6,})/i;
// Priority 2: CBE FT-number pattern — starts with FT, 8–20 chars total.
const CBE_FT_RE = /\bFT[A-Z0-9]{6,18}\b/i;
// Priority 3: generic alphanumeric token (fallback).
const GENERIC_TOKEN_RE = /\b(?=[A-Z0-9]{6,20}\b)(?=[A-Z0-9]*[0-9])(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,20}\b/;

const NAME_LABEL_RE = /(?:sender|from|payer|account\s*name|name)\s*[:-]?\s*([A-Za-z][A-Za-z .'-]{2,60})/i;

function extractTxnId(text) {
  const labeled = text.match(TXN_LABEL_RE);
  if (labeled) return labeled[1].trim();
  const ft = text.toUpperCase().match(CBE_FT_RE);
  if (ft) return ft[0];
  const generic = text.toUpperCase().match(GENERIC_TOKEN_RE);
  return generic ? generic[0] : null;
}

function extractName(text) {
  const labeled = text.match(NAME_LABEL_RE);
  if (labeled) {
    // Trim trailing junk the regex may have swept in (next label, newline text).
    return labeled[1].split('\n')[0].trim().replace(/\s{2,}/g, ' ');
  }
  return null;
}

/**
 * @returns {Promise<{
 *   txnId: string|null, name: string|null, amount: number|null,
 *   bankName: string|null, date: string|null,
 *   source: 'groq-vision'|'groq'|'regex', rawText: string
 * }>}
 */
async function parseReceiptImage(fileBuffer, mimetype, filename) {
  // Optional path: a Groq vision model reads the screenshot directly, no
  // OCR.space involved. Off by default (see GROQ_VISION_ENABLED in
  // .env.example) — extractReceiptFieldsFromImage returns null immediately
  // without any network call unless explicitly enabled, so this is a
  // no-op on every request today and OCR.space below is the real path.
  // Kept behind try/catch so that if it's ever enabled, a failed/misconfig
  // call still falls back to OCR.space instead of failing the request.
  try {
    const visionResult = await extractReceiptFieldsFromImage(fileBuffer, mimetype);
    if (visionResult) {
      return { ...visionResult, source: 'groq-vision', rawText: '' };
    }
  } catch (err) {
    console.warn('[ocrReceipt] Groq vision extraction failed, falling back to OCR.space:', err.message);
  }

  // Primary path: OCR.space extracts the raw text off the screenshot
  // first; Groq then classifies that text into structured fields (amount
  // vs. txn ID vs. sender name, etc.) — Groq never sees the image itself
  // here, only the text OCR.space already extracted. Used when the vision
  // path above isn't configured or just failed/threw.
  const rawText = await ocrSpaceParse(fileBuffer, mimetype, filename);

  // Regex pass always runs first — it's free, fast, and is the fallback if
  // Groq is unavailable or returns something unusable.
  const regexResult = {
    txnId: extractTxnId(rawText),
    name: extractName(rawText),
    amount: null,
    bankName: null,
    date: null,
  };

  if (!rawText.trim()) {
    return { ...regexResult, source: 'regex', rawText };
  }

  try {
    const aiResult = await extractReceiptFields(rawText, regexResult);
    if (aiResult) {
      return {
        txnId: aiResult.txnId ?? regexResult.txnId,
        name: aiResult.name ?? regexResult.name,
        amount: aiResult.amount ?? null,
        bankName: aiResult.bankName ?? null,
        date: aiResult.date ?? null,
        source: 'groq',
        rawText,
      };
    }
  } catch (err) {
    // Groq being down/misconfigured/rate-limited must never block the
    // upload flow — the regex result is still a usable prefill.
    console.error('[ocrReceipt] Groq extraction failed, falling back to regex:', err.message);
  }

  return { ...regexResult, source: 'regex', rawText };
}

function isStubActive() {
  // Regex-only fallback kicks in only if BOTH Groq (vision + text) and
  // OCR.space are unconfigured.
  return !process.env.GROQ_API_KEY && !process.env.OCRSPACE_API_KEY;
}

module.exports = { parseReceiptImage, isStubActive };
