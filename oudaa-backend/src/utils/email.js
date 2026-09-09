// -----------------------------------------------------------------------
// Outbound email — sent via Brevo's transactional email HTTP API.
//
// See: https://developers.brevo.com/docs/send-a-transactional-email
//
// Brevo is called as a plain HTTPS request to
// https://api.brevo.com/v3/smtp/email — there is no SMTP socket
// involved, which sidesteps the class of "Connection timeout" problems
// PaaS hosts like Render have with raw SMTP (their network resolves
// many SMTP hosts' AAAA/IPv6 records but can't actually route to them).
//
// Configure with:
//   BREVO_API_KEY       - required. From Brevo > Settings > SMTP & API > API Keys.
//   BREVO_SENDER_EMAIL   - required to actually send. Must be a verified
//                          sender/domain in your Brevo account.
//   BREVO_SENDER_NAME    - optional, defaults to "Oudaa".
//
// If BREVO_API_KEY (or BREVO_SENDER_EMAIL) isn't configured, this module
// runs in STUB MODE — the email is logged to the console instead of
// actually sent, so local dev keeps working without needing real mail
// credentials (same pattern as bankVerification.js's Veritas stub mode).
// Never throws: a failed/absent email should never block the API action
// that triggered it (e.g. deactivating a resident still succeeds even if
// the notification email fails to send).
// -----------------------------------------------------------------------

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || '';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Oudaa';

function isConfigured() {
  return Boolean(BREVO_API_KEY && BREVO_SENDER_EMAIL);
}

function isStubActive() {
  return !isConfigured();
}

/**
 * Verifies the outbound email path at boot so a bad config shows up
 * immediately in the server logs instead of silently failing the first
 * time a real user requests a password reset. Never throws.
 *
 * Brevo has no dedicated "verify credentials" call, so this pings the
 * account endpoint (GET /v3/account), which requires a valid api-key
 * and is a lightweight way to confirm the key actually authenticates.
 */
async function verifyEmailTransport() {
  if (isStubActive()) return { ok: false, stub: true };

  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'api-key': BREVO_API_KEY,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Brevo API rejected the key (${res.status}): ${body.slice(0, 300)}`);
    }

    console.log('[email] Brevo API key verified — outbound email is live.');
    return { ok: true, stub: false, provider: 'brevo' };
  } catch (err) {
    console.error(
      `[email] Brevo is configured but the API key FAILED to verify — emails will NOT be sent until this is fixed: ${err.message}.`,
    );
    return { ok: false, stub: false, provider: 'brevo', error: err.message };
  }
}

async function sendViaBrevo({ to, subject, text, html }) {
  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html || `<pre>${text}</pre>`,
      textContent: text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo API request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Sends an email. Resolves to { sent: boolean, stub: boolean } and never
 * rejects — callers should fire-and-forget or await without try/catch if
 * they don't care about the outcome.
 */
async function sendEmail({ to, subject, text, html }) {
  if (!to) return { sent: false, stub: isStubActive() };

  if (isStubActive()) {
    console.warn('[email] Brevo not configured (BREVO_API_KEY / BREVO_SENDER_EMAIL) — running in STUB mode, email logged instead of sent.');
    console.warn(`[email:STUB] To: ${to} | Subject: ${subject}\n${text}`);
    return { sent: false, stub: true };
  }

  try {
    await sendViaBrevo({ to, subject, text, html });
    return { sent: true, stub: false, provider: 'brevo' };
  } catch (err) {
    console.error('[email] Failed to send email via Brevo:', err.message);
    return { sent: false, stub: false, provider: 'brevo', error: err.message };
  }
}

/**
 * Notifies a resident that their account was deactivated, and why.
 */
async function sendResidentDeactivatedEmail({ to, fullName, reason, communityName }) {
  const subject = `Your ${communityName || 'community'} account has been deactivated`;
  const text = [
    `Hello ${fullName},`,
    '',
    `Your resident account${communityName ? ` for ${communityName}` : ''} has been deactivated by the committee.`,
    '',
    `Reason: ${reason}`,
    '',
    'You will not be able to log in while your account is inactive. If you believe this is a mistake or would like more information, please contact the committee office.',
    '',
    '— Oudaa',
  ].join('\n');
  const html = `
    <p>Hello ${fullName},</p>
    <p>Your resident account${communityName ? ` for <strong>${communityName}</strong>` : ''} has been deactivated by the committee.</p>
    <p><strong>Reason:</strong> ${reason}</p>
    <p>You will not be able to log in while your account is inactive. If you believe this is a mistake or would like more information, please contact the committee office.</p>
    <p>— Oudaa</p>
  `;
  return sendEmail({ to, subject, text, html });
}

/**
 * Sends a "reset your password" link. The link itself (with the raw,
 * unhashed token) is built by the caller (authController), since only it
 * knows the frontend's base URL.
 */
async function sendPasswordResetEmail({ to, fullName, resetUrl, expiresInMinutes }) {
  const subject = 'Reset your Oudaa password';
  const text = [
    `Hello ${fullName},`,
    '',
    'We received a request to reset the password on your Oudaa account.',
    `This link is valid for ${expiresInMinutes} minutes and can only be used once:`,
    '',
    resetUrl,
    '',
    "If you didn't request this, you can safely ignore this email — your password won't be changed.",
    '',
    '— Oudaa',
  ].join('\n');
  const html = `
    <p>Hello ${fullName},</p>
    <p>We received a request to reset the password on your Oudaa account.</p>
    <p>This link is valid for ${expiresInMinutes} minutes and can only be used once:</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
    <p>— Oudaa</p>
  `;
  return sendEmail({ to, subject, text, html });
}

/**
 * Confirms a password was just changed — sent on both self-service
 * (change-password) and forgot/reset-password flows, so someone whose
 * account was compromised gets a signal even if they didn't initiate it.
 */
async function sendPasswordChangedEmail({ to, fullName }) {
  const subject = 'Your Oudaa password was changed';
  const text = [
    `Hello ${fullName},`,
    '',
    'This is a confirmation that the password on your Oudaa account was just changed.',
    '',
    "If this wasn't you, please contact your community's committee office immediately.",
    '',
    '— Oudaa',
  ].join('\n');
  const html = `
    <p>Hello ${fullName},</p>
    <p>This is a confirmation that the password on your Oudaa account was just changed.</p>
    <p>If this wasn't you, please contact your community's committee office immediately.</p>
    <p>— Oudaa</p>
  `;
  return sendEmail({ to, subject, text, html });
}

/**
 * General-purpose notification email — for one-off announcements
 * (fee due, payment verified, expense logged against a project the
 * resident follows, etc.) that don't warrant their own dedicated
 * template. Callers pass already-composed copy.
 */
async function sendNotificationEmail({ to, fullName, subject, message, communityName }) {
  const greeting = fullName ? `Hello ${fullName},` : 'Hello,';
  const text = [greeting, '', message, '', '— ' + (communityName || 'Oudaa')].join('\n');
  const html = `
    <p>${greeting}</p>
    <p>${message}</p>
    <p>— ${communityName || 'Oudaa'}</p>
  `;
  return sendEmail({ to, subject, text, html });
}

/**
 * Sent once, right when the committee adds a new resident. Carries the
 * temporary password the committee sees on screen (only ever shown to
 * them one time — see createResident) plus a direct login link, so the
 * resident can get into their account even if the committee never
 * relays the password some other way.
 */
async function sendResidentWelcomeEmail({ to, fullName, tempPassword, loginUrl, communityName }) {
  const subject = `Welcome to ${communityName || 'Oudaa'} — your account is ready`;
  const text = [
    `Hello ${fullName},`,
    '',
    `An account has been created for you${communityName ? ` in ${communityName}` : ''}. Here are your sign-in details:`,
    '',
    `Email: ${to}`,
    `Temporary password: ${tempPassword}`,
    '',
    `Sign in here: ${loginUrl}`,
    '',
    'For your security, please sign in and change this password as soon as possible.',
    '',
    '— Oudaa',
  ].join('\n');
  const html = `
    <p>Hello ${fullName},</p>
    <p>An account has been created for you${communityName ? ` in <strong>${communityName}</strong>` : ''}. Here are your sign-in details:</p>
    <p>
      <strong>Email:</strong> ${to}<br/>
      <strong>Temporary password:</strong> ${tempPassword}
    </p>
    <p><a href="${loginUrl}">Sign in to your account</a></p>
    <p>For your security, please sign in and change this password as soon as possible.</p>
    <p>— Oudaa</p>
  `;
  return sendEmail({ to, subject, text, html });
}

/**
 * Sent once, right when a brand-new community finishes the signup wizard.
 * The founding admin is auto-signed-in in the browser that just submitted
 * the wizard, but this email is their durable record of the one thing
 * that's unique to them going forward: their community's own login link
 * (https://<host>/<community-slug>). Every other community gets a
 * different slug and therefore a different link — this is the "custom
 * community link" residents/admins bookmark and use to sign back in,
 * since the platform intentionally has no generic /login entry point for
 * end users (see Signup.jsx removing that link, and authController.login's
 * communitySlug check rejecting cross-tenant logins).
 */
async function sendCommunityWelcomeEmail({ to, fullName, communityName, loginUrl }) {
  const subject = `${communityName} is live on Oudaa — here's your login link`;
  const text = [
    `Hello ${fullName},`,
    '',
    `${communityName} has been created on Oudaa. This is your community's own, permanent sign-in link:`,
    '',
    loginUrl,
    '',
    'Bookmark it — it\'s the only place your community\'s residents and committee can sign in, and it only works for this community\'s accounts.',
    '',
    'You were signed in automatically just now, so you can start setting things up right away.',
    '',
    '— Oudaa',
  ].join('\n');
  const html = `
    <p>Hello ${fullName},</p>
    <p><strong>${communityName}</strong> has been created on Oudaa. This is your community's own, permanent sign-in link:</p>
    <p><a href="${loginUrl}">${loginUrl}</a></p>
    <p>Bookmark it — it's the only place your community's residents and committee can sign in, and it only works for this community's accounts.</p>
    <p>You were signed in automatically just now, so you can start setting things up right away.</p>
    <p>— Oudaa</p>
  `;
  return sendEmail({ to, subject, text, html });
}

module.exports = {
  sendEmail,
  sendResidentDeactivatedEmail,
  sendResidentWelcomeEmail,
  sendCommunityWelcomeEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendNotificationEmail,
  isStubActive,
  verifyEmailTransport,
};
