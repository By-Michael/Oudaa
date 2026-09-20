// -----------------------------------------------------------------------
// Takes raw OCR text from a payment screenshot and asks a Groq-hosted LLM
// to classify which substrings are the amount, sender/account name,
// transaction ID, bank name, and date. This exists because OCR.space
// returns an unstructured text blob — it doesn't know "1,250.00 ETB" is
// the amount vs. a stray number, or that a 10-digit string is a phone
// number and not a transaction reference. An LLM reading the text with
// labeled context does a much better job of that classification than
// regex alone, especially across the many different bank receipt layouts
// in circulation.
//
// This module NEVER sees the image — only the OCR text — so it cannot fix
// a bad OCR read, only interpret a decent one better. Output is always a
// best-effort suggestion; nothing here is trusted for verification.
// -----------------------------------------------------------------------

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Groq model IDs that are fully shut down (calls 404 with model_not_found).
// If a deployment's env still points GROQ_MODEL at one of these — e.g. a
// stale Render/hosting env var — we ignore it and fall back to the current
// default below instead of failing every request.
const RETIRED_GROQ_MODELS = new Set([
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'qwen/qwen3-32b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'moonshotai/kimi-k2-instruct',
  'moonshotai/kimi-k2-instruct-0905',
  'gemma2-9b-it',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'mixtral-8x7b-32768',
  'gemma-7b-it',
  'llama-3.2-1b-preview',
]);

function resolveModel(envValue, fallback, label) {
  if (envValue && RETIRED_GROQ_MODELS.has(envValue)) {
    console.warn(
      `[groqReceiptParser] ${label} env var is set to "${envValue}", which Groq has retired. ` +
      `Ignoring it and using "${fallback}" instead. Update/remove the env var to silence this warning.`
    );
    return fallback;
  }
  return envValue || fallback;
}

// llama-3.1-8b-instant was retired by Groq — silently 404'd on every call,
// which is why classification looked "broken" even though OCR.space itself
// was returning text fine. Groq's migration guidance points text-only
// traffic at gpt-oss-120b now. Override via env if you want a different
// (currently-active) model.
const GROQ_MODEL = resolveModel(process.env.GROQ_MODEL, 'openai/gpt-oss-120b', 'GROQ_MODEL');

// Strict JSON Schema for the extracted fields. Using response_format:
// { type: 'json_schema', json_schema: { strict: true, ... } } instead of
// the looser { type: 'json_object' } mode makes Groq constrain generation
// at the token level, so it can no longer return malformed/incomplete JSON
// (the "json_validate_failed" 400 we were seeing intermittently from the
// vision model). Strict mode requires every property to be listed in
// `required` and `additionalProperties: false`; nullable fields use a
// ["type", "null"] union instead of a separate `nullable` flag.
const RECEIPT_FIELDS_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'receipt_fields',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        amount: { type: ['number', 'null'], description: 'The transferred amount, no currency symbol or commas.' },
        name: { type: ['string', 'null'], description: "The sender's / payer's name (not the recipient/bank staff)." },
        txnId: { type: ['string', 'null'], description: 'Transaction ID / reference number / FT number.' },
        bankName: { type: ['string', 'null'], description: 'The bank or mobile money provider name.' },
        date: { type: ['string', 'null'], description: 'Transaction date, ISO 8601 (YYYY-MM-DD) if determinable.' },
      },
      required: ['amount', 'name', 'txnId', 'bankName', 'date'],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `You extract structured fields from OCR text of a bank payment/transfer receipt or screenshot. The OCR text may be messy, have broken line breaks, or missing spaces. This is most commonly a Commercial Bank of Ethiopia (CBE) receipt.

Return ONLY a JSON object, no prose, no markdown fences, with exactly these keys:
{
  "amount": number or null,       // the transferred amount, as a plain number, no currency symbol or commas
  "name": string or null,         // the sender's / payer's full name (not the recipient, not bank staff)
  "txnId": string or null,        // transaction ID / reference number / FT number (see rules below)
  "bankName": string or null,     // the bank or mobile money provider name
  "date": string or null          // transaction date, ISO 8601 (YYYY-MM-DD) if you can determine it, else null
}

Rules:
- If a field is not clearly present in the text, use null. Never guess or invent a value.
- amount must be a plain JSON number (e.g. 1250.5), not a string, not formatted with commas or currency symbols.
- txnId extraction rules (in priority order):
    1. Look for a label like "Transaction ID", "Txn ID", "Reference", "Ref No", "FT No", "FT#" followed by an alphanumeric value — that labeled value IS the txnId.
    2. CBE receipts commonly use FT-numbers: alphanumeric strings starting with "FT" followed by digits and letters (e.g. FT24219XXXXX, FT2024ABCD12). If you see one, it is almost certainly the txnId.
    3. If no label and no FT-number, look for a standalone alphanumeric string of 8–20 characters that mixes letters and digits and appears in isolation (not embedded in a sentence), which is plausibly a bank reference.
    4. Never use account numbers (usually pure digits, 10–16 digits), phone numbers (10–12 digits, often starting with 09 or +251), or amounts as the txnId.
- name must be the sender's / payer's full name. On CBE receipts this is often labeled "Sender", "From", "Account Name", or "Name". Do not use the recipient's name or the teller/branch name.
- Respond with the JSON object only.`;

// Defensive normalization — never trust the model to perfectly follow the
// schema, especially on amount's type. Shared by both the text and vision
// extraction paths since they return the same shape.
function normalizeParsedFields(parsed) {
  const amount = typeof parsed.amount === 'number' && Number.isFinite(parsed.amount)
    ? parsed.amount
    : (typeof parsed.amount === 'string' && parsed.amount.trim() !== '' && !Number.isNaN(Number(parsed.amount.replace(/,/g, '')))
      ? Number(parsed.amount.replace(/,/g, ''))
      : null);

  return {
    amount,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null,
    txnId: typeof parsed.txnId === 'string' && parsed.txnId.trim() ? parsed.txnId.trim() : null,
    bankName: typeof parsed.bankName === 'string' && parsed.bankName.trim() ? parsed.bankName.trim() : null,
    date: typeof parsed.date === 'string' && parsed.date.trim() ? parsed.date.trim() : null,
  };
}

/**
 * POSTs to the Groq chat completions endpoint, preferring strict JSON
 * Schema mode but transparently retrying once with looser JSON Object mode
 * if the model doesn't support schema mode (not all Groq models do — see
 * RECEIPT_FIELDS_SCHEMA comment above). This keeps us from swapping the
 * intermittent "json_validate_failed" error for a hard "response_format
 * not supported" error on models that lack schema support.
 * @returns {Promise<Response>}
 */
async function groqChatCompletion(apiKey, body) {
  let res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ ...body, response_format: RECEIPT_FIELDS_SCHEMA }),
  });

  if (!res.ok && res.status === 400) {
    const bodyText = await res.clone().text().catch(() => '');
    if (/response_format|json_schema|does not support/i.test(bodyText)) {
      res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ ...body, response_format: { type: 'json_object' } }),
      });
    }
  }

  return res;
}

/**
 * @param {string} rawText - OCR-extracted text from the receipt image
 * @param {{txnId: string|null, name: string|null}} regexHints - best-effort
 *   regex matches, passed in as a hint since they're sometimes right and
 *   can anchor the model, but the model is free to disagree with them.
 * @returns {Promise<{amount:number|null,name:string|null,txnId:string|null,bankName:string|null,date:string|null}|null>}
 *   Returns null (never throws) if Groq isn't configured — caller falls
 *   back to regex-only. Throws on a configured-but-failed call so the
 *   caller can log it distinctly from "not configured".
 */
async function extractReceiptFields(rawText, regexHints = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null; // not configured — silent fallback to regex

  const userContent = [
    'OCR text from the receipt:',
    '"""',
    rawText.slice(0, 4000), // guard against pathological OCR output
    '"""',
    '',
    `Regex already guessed txnId="${regexHints.txnId || ''}" and name="${regexHints.name || ''}" — use these as hints only if they look right; ignore them if you find better matches.`,
  ].join('\n');

  const res = await groqChatCompletion(apiKey, {
    model: GROQ_MODEL,
    temperature: 0,
    max_tokens: 300,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Groq API request failed (${res.status}): ${bodyText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq response had no content');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Groq response was not valid JSON: ${content.slice(0, 200)}`);
  }

  return normalizeParsedFields(parsed);
}

// Vision-capable Groq model — reads the screenshot image directly instead
// of classifying pre-extracted OCR text. This is the "primary path"
// referenced in .env.example: when configured, it skips OCR.space
// entirely, so an OCR.space outage/throttle (e.g. free-tier "E571
// overloaded") no longer blocks autofill as long as Groq is up.
// NOTE: meta-llama/llama-4-scout-17b-16e-instruct and
// meta-llama/llama-4-maverick-17b-128e-instruct (Groq's old vision models)
// are both deprecated/in RETIRED_GROQ_MODELS above. As of mid-2026 Groq's
// migration guidance for multimodal (image) traffic points to
// qwen/qwen3.6-27b. Check https://console.groq.com/docs/models for the
// current vision-capable lineup and override via GROQ_VISION_MODEL if this
// default gets retired too — Groq's multimodal lineup changes often.
const GROQ_VISION_MODEL = resolveModel(
  process.env.GROQ_VISION_MODEL,
  'qwen/qwen3.6-27b',
  'GROQ_VISION_MODEL'
);

const VISION_SYSTEM_PROMPT = `You extract structured fields from an image of a bank payment/transfer receipt or screenshot. This is most commonly a Commercial Bank of Ethiopia (CBE) receipt.

Return ONLY a JSON object, no prose, no markdown fences, with exactly these keys:
{
  "amount": number or null,       // the transferred amount, as a plain number, no currency symbol or commas
  "name": string or null,         // the sender's / payer's full name (not the recipient, not bank staff)
  "txnId": string or null,        // transaction ID / reference number / FT number (see rules below)
  "bankName": string or null,     // the bank or mobile money provider name
  "date": string or null          // transaction date, ISO 8601 (YYYY-MM-DD) if you can determine it, else null
}

Rules:
- If a field is not clearly present in the image, use null. Never guess or invent a value.
- amount must be a plain JSON number (e.g. 1250.5), not a string, not formatted with commas or currency symbols.
- txnId extraction rules (in priority order):
    1. Look for a label like "Transaction ID", "Txn ID", "Reference", "Ref No", "FT No", "FT#" followed by an alphanumeric value — that labeled value IS the txnId.
    2. CBE receipts commonly use FT-numbers: alphanumeric strings starting with "FT" followed by digits and letters (e.g. FT24219XXXXX, FT2024ABCD12). If you see one, it is almost certainly the txnId.
    3. If no label and no FT-number, look for a standalone alphanumeric string of 8–20 characters that mixes letters and digits and appears in isolation, which is plausibly a bank reference.
    4. Never use account numbers (usually pure digits, 10–16 digits), phone numbers (10–12 digits starting with 09 or +251), or amounts as the txnId.
- name must be the sender's / payer's full name. On CBE receipts this is often labeled "Sender", "From", "Account Name", or "Name". Do not use the recipient's name or the teller/branch name.
- Respond with the JSON object only.`;

/**
 * Reads the receipt screenshot directly with a Groq vision model — no
 * OCR.space involved. This is the preferred path when GROQ_API_KEY is
 * configured; callers should fall back to parseReceiptImage's OCR.space +
 * text-classification path only if this throws or Groq isn't configured.
 *
 * @param {Buffer} fileBuffer
 * @param {string} mimetype - must be an image type Groq's vision models
 *   accept (jpeg/png/webp); PDFs are not supported here.
 * @returns {Promise<{amount:number|null,name:string|null,txnId:string|null,bankName:string|null,date:string|null}|null>}
 *   Returns null (never throws) if Groq isn't configured — caller falls
 *   back to OCR.space + regex/text-classification. Throws on a
 *   configured-but-failed call so the caller can log it distinctly.
 */
async function extractReceiptFieldsFromImage(fileBuffer, mimetype) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null; // not configured — silent fallback to OCR.space path

  const base64 = fileBuffer.toString('base64');
  const dataUrl = `data:${mimetype};base64,${base64}`;

  const res = await groqChatCompletion(apiKey, {
    model: GROQ_VISION_MODEL,
    temperature: 0,
    max_tokens: 300,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract the receipt fields from this screenshot.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Groq vision API request failed (${res.status}): ${bodyText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq vision response had no content');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Groq vision response was not valid JSON: ${content.slice(0, 200)}`);
  }

  return normalizeParsedFields(parsed);
}

function isStubActive() {
  return !process.env.GROQ_API_KEY;
}

module.exports = { extractReceiptFields, extractReceiptFieldsFromImage, isStubActive };
