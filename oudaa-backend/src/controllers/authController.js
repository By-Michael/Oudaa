const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { phoneSearchKeyFor } = require('../utils/phone');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require('../utils/tokens');
const { sendPasswordResetEmail, sendPasswordChangedEmail, sendCommunityWelcomeEmail, sendCommitteeInviteEmail } = require('../utils/email');
const { generateUniqueSlug, RESERVED_SLUGS } = require('../utils/slugify');

const PASSWORD_RESET_EXPIRES_MINUTES = 30;
// Minimum gap between reset emails to the same address — prevents mail-bombing
// a user even when requests arrive from different IPs (which the IP-keyed
// authLimiter alone can't stop). Matches the OTP request cooldown in userController.
const FORGOT_PASSWORD_COOLDOWN_SECONDS = 60;
// Where the frontend's reset-password page lives, e.g.
// https://app.example.com/reset-password?token=... — matches the
// CORS_ORIGIN pattern used elsewhere in this file for cross-service URLs.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const REFRESH_COOKIE_NAME = 'oudaa_refresh_token';
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // 'lax' works fine in dev where frontend and backend share an origin
  // (Vite's proxy makes localhost:5173 -> localhost:4000 look same-site).
  // In production the frontend and backend are almost always on different
  // hosts (e.g. two separate Render services), which makes this a genuine
  // cross-site request — browsers won't attach a 'lax' cookie to that, so
  // /auth/refresh would silently never receive it and users would get
  // logged out the moment their access token expired. 'none' (paired with
  // secure, required by spec) fixes that and is harmless same-site too.
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days (matches JWT_REFRESH_EXPIRES_IN default)
  path: '/api/v1/auth',
};

async function issueTokenPair(res, user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      communityId: user.communityId || null,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTS);
  return accessToken;
}

function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

/**
 * Public SaaS signup: onboards a brand-new tenant (Community) plus its
 * first ADMIN user in a single transaction.
 */
const registerCommunity = catchAsync(async (req, res) => {
  const { community, admin } = req.body;
  // Normalize casing before both the lookup and the create below — without
  // this, "Admin@x.com" and "admin@x.com" are treated as different users by
  // the duplicate check but the same user at login (login() normalizes),
  // so a case-mismatched duplicate would slip past this check entirely.
  const adminEmail = admin.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) throw new AppError(`The email "${adminEmail}" is already registered. Try logging in instead.`, 409);

  // Prevent welcome-email spam: if a registration with this admin email was
  // attempted within the last 60 seconds (e.g. a retry loop or duplicate
  // form submission), reject early before creating any DB rows or sending
  // another email. Uses the same cooldown window as the OTP request endpoint.
  // Note: this check is best-effort (not wrapped in a transaction with the
  // inserts below) but is sufficient to stop accidental and low-effort abuse.
  const recentSignup = await prisma.user.findFirst({
    where: {
      email: adminEmail,
      createdAt: { gt: new Date(Date.now() - 60 * 1000) },
    },
  });
  if (recentSignup) throw new AppError('A registration with this email was just submitted. Please wait a moment before trying again.', 429);

  // A requested subdomain must not collide with a platform route
  // (acme.oudaa.app is fine; app.oudaa.app or api.oudaa.app would shadow
  // the platform itself) or an existing community's slug. Falls back to
  // auto-generating from the name either way, so a bad/unavailable
  // request never blocks signup.
  const wantsSlug = community.slug && !RESERVED_SLUGS.has(community.slug);
  const slug = await generateUniqueSlug(wantsSlug ? community.slug : community.name);

  const passwordHash = await bcrypt.hash(admin.password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const createdCommunity = await tx.community.create({
      data: { ...community, slug },
    });
    const createdAdmin = await tx.user.create({
      data: {
        communityId: createdCommunity.id,
        fullName: admin.fullName,
        email: adminEmail,
        passwordHash,
        role: 'ADMIN',
      },
    });
    // Every committee member is expected to also have a Resident row (see
    // residentToUI's isCommittee comment) — the "Committee only" filter on
    // the Residents panel, and any other screen that lists committee
    // members, reads off this table. Without this, the founding admin
    // created here had no Resident row at all and simply never appeared
    // anywhere residents are listed, including under "Committee only".
    // unitNumber is a required column with nothing meaningful to default
    // it to at signup time, so we use a clearly-labeled placeholder that
    // the admin can edit later from their own resident profile.
    await tx.resident.create({
      data: {
        communityId: createdCommunity.id,
        userId: createdAdmin.id,
        unitNumber: 'N/A',
        status: 'ACTIVE',
      },
    });
    return { createdCommunity, createdAdmin };
  });

  const accessToken = await issueTokenPair(res, result.createdAdmin);

  // Every community gets its own permanent login link at
  // <FRONTEND_URL>/<slug> — the only place this community's accounts can
  // sign in (see login()'s communitySlug check, and Login.jsx's route
  // param). The admin is already signed in via the cookie/token above, so
  // this email is their durable record of that link rather than something
  // blocking access right now. Fire-and-forget: a failed email must never
  // undo an otherwise-successful signup.
  const loginUrl = `${FRONTEND_URL.replace(/\/$/, '')}/${slug}`;
  sendCommunityWelcomeEmail({
    to: result.createdAdmin.email,
    fullName: result.createdAdmin.fullName,
    communityName: result.createdCommunity.name,
    loginUrl,
  }).catch(() => {});

  res.status(201).json({
    success: true,
    data: {
      community: result.createdCommunity,
      user: sanitizeUser(result.createdAdmin),
      accessToken,
    },
  });
});

const login = catchAsync(async (req, res) => {
  const { identifier, password, communitySlug } = req.body;
  const looksLikeEmail = identifier.includes('@');

  let user;
  if (looksLikeEmail) {
    user = await prisma.user.findUnique({ where: { email: identifier.trim().toLowerCase() } });
  } else {
    // Previously this pulled EVERY resident with a phone number (across
    // every tenant on the platform) into Node and scanned them one by one
    // with String#endsWith — a full table scan on every single phone
    // login that got slower as the resident table grew. phoneSearchKey
    // is a precomputed, indexed last-9-digits value kept in sync whenever
    // a phone is written (see residentController), so this is now a
    // single indexed equality lookup regardless of table size.
    const key = phoneSearchKeyFor(identifier);
    const match = key
      ? await prisma.resident.findFirst({ where: { phoneSearchKey: key }, include: { user: true } })
      : null;
    user = match?.user || null;
  }

  if (!user) throw new AppError('Invalid credentials', 401);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AppError('Invalid credentials', 401);

  // If the login page was loaded from a community's subdomain
  // (acme.oudaa.app), the frontend sends that slug along so we can refuse
  // to authenticate someone into the wrong tenant's portal — e.g. a
  // resident of "acme" typing their credentials in on "beta.oudaa.app" by
  // mistake. Deliberately phrased the same as "Invalid credentials" would
  // read to an attacker (no separate error surface to enumerate slugs
  // against), but distinct enough that a genuine user knows what to fix.
  if (communitySlug) {
    const community = user.communityId
      ? await prisma.community.findUnique({ where: { id: user.communityId } })
      : null;
    if (!community || community.slug !== communitySlug) {
      throw new AppError('This account is not part of this community’s portal', 403);
    }
    if (community.status === 'SUSPENDED') {
      throw new AppError('This community has been suspended. Please contact support.', 403);
    }
  } else if (user.communityId) {
    // No slug to cross-check (e.g. a non-subdomain login path), but a
    // suspended community must still block a fresh login — see
    // Community.status (added in the platform-admin console's Phase 2).
    // Note this only prevents a NEW login; a token issued before
    // suspension remains valid until it naturally expires (see the
    // schema comment on Community.status for why that's intentional for
    // now).
    const community = await prisma.community.findUnique({ where: { id: user.communityId } });
    if (community?.status === 'SUSPENDED') {
      throw new AppError('This community has been suspended. Please contact support.', 403);
    }
  }

  // A resident whose account has been deactivated by the committee (for
  // non-payment or any other reason) can't log in — even with the right
  // password — until the committee reactivates them. Committee members
  // (ADMIN) are unaffected even though they also have a Resident record.
  if (user.role === 'RESIDENT') {
    const resident = await prisma.resident.findUnique({ where: { userId: user.id } });
    if (resident && resident.status !== 'ACTIVE') {
      throw new AppError(
        'Your account has been deactivated. Please contact the committee office for more information.',
        403
      );
    }
  }

  const accessToken = await issueTokenPair(res, user);

  // Include resident/community relations directly in the login response
  // (one cheap extra query on a request we're already making) instead of
  // making the frontend fire a second full HTTP round trip to /auth/me
  // immediately after login just to get residentId/community name.
  const fullUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { resident: true, community: true },
  });

  res.json({
    success: true,
    data: { user: sanitizeUser(fullUser), accessToken },
  });
});

const refresh = catchAsync(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
  if (!token) throw new AppError('Refresh token missing', 401);

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    throw new AppError('Refresh token is no longer valid', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { resident: true, community: true },
  });
  if (!user) throw new AppError('User no longer exists', 401);

  // Rotate: revoke the used token and issue a brand-new pair.
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revoked: true },
  });

  const accessToken = await issueTokenPair(res, user);

  res.json({ success: true, data: { user: sanitizeUser(user), accessToken } });
});

const logout = catchAsync(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
  if (token) {
    await prisma.refreshToken
      .updateMany({
        where: { tokenHash: hashToken(token) },
        data: { revoked: true },
      })
      .catch(() => {});
  }
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
  res.json({ success: true, message: 'Logged out' });
});

const me = catchAsync(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { resident: true, community: true },
  });
  res.json({ success: true, data: sanitizeUser(user) });
});

/**
 * Self-service password change. Requires the caller's current password so
 * a hijacked session alone can't lock the real owner out, and revokes every
 * *other* outstanding refresh token so other logged-in sessions/devices are
 * forced to re-authenticate with the new password.
 *
 * The session making this request is deliberately spared: the person is
 * sitting right here having just proven they know both the old password
 * (this request) and control of the session (their access token), so there's
 * no security reason to kick them out too. Their current refresh token is
 * rotated (not just left as-is) so it's freshly issued after the password
 * change, and the new access token is returned in the response so the
 * frontend can swap it in without a round trip through /auth/refresh.
 */
const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError('User no longer exists', 401);

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new AppError('Current password is incorrect', 401);

  // Identify (but don't yet touch) the refresh token backing *this*
  // session, so it can be excluded from the mass-revoke below and rotated
  // on its own right after.
  const currentRawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  const currentTokenHash = currentRawToken ? hashToken(currentRawToken) : null;

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: {
        userId: user.id,
        revoked: false,
        ...(currentTokenHash ? { tokenHash: { not: currentTokenHash } } : {}),
      },
      data: { revoked: true },
    }),
  ]);

  // Rotate the surviving session's own token pair (same pattern as
  // /auth/refresh) so the person keeps working without interruption, on a
  // token pair generated after — not before — the password change.
  if (currentTokenHash) {
    await prisma.refreshToken
      .updateMany({ where: { tokenHash: currentTokenHash }, data: { revoked: true } })
      .catch(() => {});
  }
  const accessToken = await issueTokenPair(res, user);

  sendPasswordChangedEmail({ to: user.email, fullName: user.fullName }).catch(() => {});

  res.json({ success: true, message: 'Password updated', data: { accessToken } });
});

/**
 * Forgot-password: issues a one-time, 30-minute reset token and emails a
 * link containing it. Always responds with the same generic message
 * regardless of whether the email matched an account — enumerating valid
 * emails via response differences is exactly what this endpoint must not
 * do, since it's unauthenticated and open to anyone.
 */
const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    // Per-email cooldown: even if requests arrive from different IPs (which
    // the IP-keyed authLimiter alone can't stop), don't send another reset
    // email within FORGOT_PASSWORD_COOLDOWN_SECONDS of the last one. Respond
    // generically so the cooldown itself isn't revealed to unauthenticated callers.
    const recentReset = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - FORGOT_PASSWORD_COOLDOWN_SECONDS * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recentReset) {
      return res.json({
        success: true,
        message: 'If an account exists for that email, a password reset link has been sent.',
      });
    }

    // Raw token goes in the email link; only its hash is persisted (same
    // pattern as RefreshToken) so a DB leak can't be replayed as a valid
    // reset link.
    const rawToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        communityId: user.communityId || null,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_EXPIRES_MINUTES * 60 * 1000),
      },
    });

    const resetUrl = `${FRONTEND_URL.replace(/\/$/, '')}/reset-password?token=${rawToken}`;
    // Fire-and-forget: sendEmail never throws (see utils/email.js), and the
    // response to the client must not reveal whether sending succeeded.
    sendPasswordResetEmail({
      to: user.email,
      fullName: user.fullName,
      resetUrl,
      expiresInMinutes: PASSWORD_RESET_EXPIRES_MINUTES,
    }).catch(() => {});
  }

  res.json({
    success: true,
    message: 'If an account exists for that email, a password reset link has been sent.',
  });
});

/**
 * Completes a forgot-password reset: validates the one-time token, sets
 * the new password, consumes the token so it can't be replayed, and (like
 * changePassword) revokes every outstanding refresh token so any other
 * logged-in session is forced to re-authenticate.
 */
const resetPassword = catchAsync(async (req, res) => {
  const { token, newPassword } = req.body;

  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!stored || stored.consumedAt || stored.expiresAt < new Date()) {
    throw new AppError('This reset link is invalid or has expired', 400);
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user) throw new AppError('User no longer exists', 400);

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { consumedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } }),
  ]);

  sendPasswordChangedEmail({ to: user.email, fullName: user.fullName }).catch(() => {});

  res.json({ success: true, message: 'Password has been reset. Please sign in with your new password.' });
});

// Very light email-format check — good enough to avoid a wasted DB round
// trip on obviously-malformed input; the real validation still happens in
// authValidators.js / here where it matters, this is just an early guard.
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * Public, unauthenticated check for whether an email already has an
 * account — lets the signup wizard tell someone their email (or a
 * committee member's) is taken while they're still filling out the form,
 * instead of only finding out after they submit the whole thing.
 *
 * Deliberately returns only a boolean, never account details, but any
 * "does this email exist" endpoint is inherently a user-enumeration
 * surface — registerCommunity's 409 already exposes the same fact, so
 * this doesn't introduce a new leak, but it is rate-limited (see
 * authRoutes.js) to make bulk-checking a list of emails impractical.
 */
const checkEmailAvailability = catchAsync(async (req, res) => {
  const raw = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!raw || !EMAIL_RE.test(raw)) {
    throw new AppError('A valid email address is required', 400);
  }
  const existing = await prisma.user.findUnique({ where: { email: raw } });
  res.json({ success: true, data: { available: !existing } });
});

/**
 * Invite a new committee member (ADMIN role) to the caller's community.
 * Creates the user account with a random unusable password hash, then
 * sends them a password-reset link so they set their own password.
 * Authenticated — only existing admins of the same community can call this.
 */
const inviteCommitteeMember = catchAsync(async (req, res) => {
  const { fullName, phone } = req.body;
  const email = req.body.email?.trim().toLowerCase();

  if (!fullName?.trim()) throw new AppError('Full name is required', 400);
  if (!email) throw new AppError('Email is required', 400);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError(`The email "${email}" is already registered to another account.`, 409);

  // Create the account with an unusable random password — the invite email
  // contains a reset link, so they set their own password on first access.
  const tempHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);

  const newUser = await prisma.user.create({
    data: {
      communityId: req.communityId,
      fullName: fullName.trim(),
      email,
      passwordHash: tempHash,
      role: 'ADMIN',
      ...(phone?.trim() ? {} : {}), // phone lives on Resident; stored in invite email only
    },
  });

  // Issue a password-reset token so the invitee can set their own password.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  await prisma.passwordResetToken.create({
    data: {
      userId: newUser.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72 h — more generous for invites
    },
  });

  const community = await prisma.community.findUnique({ where: { id: req.communityId } });
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/${community.slug}/reset-password?token=${rawToken}`;

  // Fire-and-forget — same pattern as forgotPassword
  sendCommitteeInviteEmail({
    to: newUser.email,
    fullName: newUser.fullName,
    invitedBy: req.user.fullName,
    communityName: community.name,
    resetUrl,
    expiresInMinutes: 72 * 60,
  });

  res.status(201).json({
    success: true,
    message: `Invite sent to ${newUser.email}.`,
    data: { id: newUser.id, fullName: newUser.fullName, email: newUser.email },
  });
});

module.exports = {
  checkEmailAvailability,
  registerCommunity,
  login,
  refresh,
  logout,
  me,
  changePassword,
  forgotPassword,
  resetPassword,
  inviteCommitteeMember,
};
