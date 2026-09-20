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

// llama-3.1-8b-instant was retired by Groq (fully shut down Aug 16, 2026) —
// silently 404'd on every call, which is why classification looked
// "broken" even though OCR.space itself was returning text fine.
// openai/gpt-oss-20b is the cheapest currently-active production text
// model on Groq ($0.075/$0.30 per 1M vs $0.15/$0.60 for the 120b variant,
// ~2x the throughput) and this task — classifying a handful of already-
// OCR'd fields — doesn't need a bigger model. Override via env if you
// want a different (currently-active) model.
const GROQ_MODEL = resolveModel(process.env.GROQ_MODEL, 'openai/gpt-oss-20b', 'GROQ_MODEL');

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

const SYSTEM_PROMPT = `You read OCR text from a bank payment receipt. The text may be messy: broken line breaks, missing spaces, random line order. This is most often a Commercial Bank of Ethiopia (CBE) receipt, but treat other banks the same way.

Your only job: fill in 5 fields from the text. Output ONLY a JSON object. No words before it. No words after it. No markdown fences like \`\`\`.

The JSON object must have exactly these 5 keys, always, in this order:
{
  "amount": number or null,
  "name": string or null,
  "txnId": string or null,
  "bankName": string or null,
  "date": string or null
}

Field-by-field rules. Read each one before you decide a value.

1. amount
- The amount of money that was sent.
- Write it as a plain number. Example: 1250.5
- Do NOT use text. Do NOT use commas. Do NOT use a currency symbol like "ETB" or "Birr".
- If you are not sure which number is the amount, use null. Do not guess.

2. name
- The name of the SENDER — the person who sent the money.
- Do NOT use the name of the person who RECEIVED the money.
- Do NOT use a bank staff name or branch name.
- Common labels for this field: "Sender", "From", "Payer", "Account Name", "Name".
- If no sender name is visible, use null.

3. txnId
- The transaction ID / reference number / FT number that identifies this one transfer.
- Check these 3 places, in this exact order, and stop at the first one that matches:
  Step 1: Look for a label word near a code. Label words: "Transaction ID", "Txn ID", "Reference", "Ref No", "FT No", "FT#". The code right after that label word is the txnId.
  Step 2: If Step 1 finds nothing, look for a code that starts with the letters "FT" followed by numbers and letters (example: FT24219ABCDE). CBE receipts almost always use this format. If you find one, it is the txnId.
  Step 3: If Step 1 and Step 2 both find nothing, look for a lone code, 8 to 20 characters long, that mixes letters and numbers, and stands by itself (not part of a sentence). Use that.
- Never use these as txnId, even if they look like a code:
  - An account number (usually only digits, 10 to 16 digits long, no letters).
  - A phone number (10 to 12 digits, often starts with "09" or "+251").
  - The amount of money.
- If none of the 3 steps find anything, use null.

4. bankName
- The name of the bank or mobile money provider on the receipt (example: "Commercial Bank of Ethiopia", "CBE", "Telebirr").
- If not visible, use null.

5. date
- The date the transfer happened.
- Write it as YYYY-MM-DD if you can tell what the date is.
- If the date format is unclear or missing, use null. Do not guess a date.

General rules that apply to every field:
- Only use information that is actually in the text. Never invent a value.
- When unsure, always choose null over a guess.
- Your entire reply must be the JSON object only, nothing else.`;

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

// Strips ```json ... ``` / ``` ... ``` fences some models wrap their
// output in despite being told not to — mainly matters for the no-
// response_format last-resort retry in groqChatCompletion, which has
// nothing enforcing a fence-free reply.
function stripJsonFences(content) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
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
    // Any 400 while in strict schema mode is worth retrying in looser
    // json_object mode — this covers both "the model doesn't support
    // response_format at all" (response_format/json_schema/does not
    // support in the message) AND "the model supports it but couldn't
    // produce output that satisfies the strict schema" (Groq's
    // json_validate_failed code, which is what was actually happening
    // here and wasn't being matched before, silently killing every
    // extraction and falling all the way back to regex).
    if (/response_format|json_schema|does not support|json_validate_failed/i.test(bodyText)) {
      res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ ...body, response_format: { type: 'json_object' } }),
      });
    }
  }

  // Last-resort retry: if json_object mode also 400s, try again with no
  // response_format constraint at all (relying purely on the prompt's
  // "Return ONLY a JSON object" instruction). Some Groq models reject
  // response_format outright rather than ignoring it, so this is the only
  // way to get a usable response from them.
  if (!res.ok && res.status === 400) {
    res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
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
    // openai/gpt-oss-120b is a reasoning model — its "thinking" tokens are
    // drawn from the same max_tokens budget as the visible output. At 300
    // tokens the model can spend the whole budget reasoning and return an
    // empty message.content with no error at all ("Groq response had no
    // content" — nothing actually failed, it just never got to writing).
    // reasoning_effort: 'low' keeps the thinking phase short for a simple
    // classification task, and max_tokens is raised to leave real headroom
    // for output after reasoning either way.
    reasoning_effort: 'low',
    max_tokens: 1024,
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
    parsed = JSON.parse(stripJsonFences(content));
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

const VISION_SYSTEM_PROMPT = `You look at an image of a bank payment receipt or screenshot. This is most often a Commercial Bank of Ethiopia (CBE) receipt, but treat other banks the same way.

Your only job: fill in 5 fields from the image. Output ONLY a JSON object. No words before it. No words after it. No markdown fences like \`\`\`.

The JSON object must have exactly these 5 keys, always, in this order:
{
  "amount": number or null,
  "name": string or null,
  "txnId": string or null,
  "bankName": string or null,
  "date": string or null
}

Field-by-field rules. Read each one before you decide a value.

1. amount
- The amount of money that was sent.
- Write it as a plain number. Example: 1250.5
- Do NOT use text. Do NOT use commas. Do NOT use a currency symbol like "ETB" or "Birr".
- If you are not sure which number is the amount, use null. Do not guess.

2. name
- The name of the SENDER — the person who sent the money.
- Do NOT use the name of the person who RECEIVED the money.
- Do NOT use a bank staff name or branch name.
- Common labels for this field: "Sender", "From", "Payer", "Account Name", "Name".
- If no sender name is visible, use null.

3. txnId
- The transaction ID / reference number / FT number that identifies this one transfer.
- Check these 3 places, in this exact order, and stop at the first one that matches:
  Step 1: Look for a label word near a code. Label words: "Transaction ID", "Txn ID", "Reference", "Ref No", "FT No", "FT#". The code right after that label word is the txnId.
  Step 2: If Step 1 finds nothing, look for a code that starts with the letters "FT" followed by numbers and letters (example: FT24219ABCDE). CBE receipts almost always use this format. If you find one, it is the txnId.
  Step 3: If Step 1 and Step 2 both find nothing, look for a lone code, 8 to 20 characters long, that mixes letters and numbers, and stands by itself (not part of a sentence). Use that.
- Never use these as txnId, even if they look like a code:
  - An account number (usually only digits, 10 to 16 digits long, no letters).
  - A phone number (10 to 12 digits, often starts with "09" or "+251").
  - The amount of money.
- If none of the 3 steps find anything, use null.

4. bankName
- The name of the bank or mobile money provider on the receipt (example: "Commercial Bank of Ethiopia", "CBE", "Telebirr").
- If not visible, use null.

5. date
- The date the transfer happened.
- Write it as YYYY-MM-DD if you can tell what the date is.
- If the date format is unclear or missing, use null. Do not guess a date.

General rules that apply to every field:
- Only use information that is actually visible in the image. Never invent a value.
- When unsure, always choose null over a guess.
- Your entire reply must be the JSON object only, nothing else.`;

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
  // Off by default. OCR.space already handles image -> text reliably for
  // this deployment, and Groq's vision lineup has been a moving target
  // (Scout/Maverick retired, qwen/qwen3.6-27b 404s as "model_not_found" on
  // this account even though Groq's own docs list it as current — almost
  // certainly a model-access/allowlist gap on this API key, not a typo).
  // Rather than burn a network round-trip and an error log on every single
  // upload chasing whichever model name Groq considers current this month,
  // this path is now opt-in: set GROQ_VISION_ENABLED=true only after
  // confirming `node scripts/check-env.js` reports GROQ_VISION_MODEL as
  // PASS for your key. Until then every call short-circuits here and
  // parseReceiptImage goes straight to the OCR.space + text-classification
  // path, which is the one actually working.
  if (process.env.GROQ_VISION_ENABLED !== 'true') return null;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null; // not configured — silent fallback to OCR.space path

  const base64 = fileBuffer.toString('base64');
  const dataUrl = `data:${mimetype};base64,${base64}`;

  // reasoning_effort only applies to gpt-oss-family reasoning models —
  // Groq's Qwen vision models don't take it, and passing an unsupported
  // param to them would 400 in a way our retry ladder isn't built to
  // recover from. Only send it when the configured vision model is
  // actually a gpt-oss model.
  const visionExtraParams = GROQ_VISION_MODEL.startsWith('openai/gpt-oss')
    ? { reasoning_effort: 'low' }
    : {};

  const res = await groqChatCompletion(apiKey, {
    model: GROQ_VISION_MODEL,
    temperature: 0,
    ...visionExtraParams,
    max_tokens: 1024,
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
    parsed = JSON.parse(stripJsonFences(content));
  } catch (err) {
    throw new Error(`Groq vision response was not valid JSON: ${content.slice(0, 200)}`);
  }

  return normalizeParsedFields(parsed);
}

function isStubActive() {
  return !process.env.GROQ_API_KEY;
}

module.exports = { extractReceiptFields, extractReceiptFieldsFromImage, isStubActive };
