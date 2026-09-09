const { z } = require('zod');

// Slug is optional — if the admin doesn't request a specific subdomain,
// one is generated from the community name (see slugify.js). When they do
// request one, it must already look like a valid subdomain label; actual
// uniqueness (and bumping RESERVED_SLUGS) is enforced in the controller,
// not here, since that needs a DB round trip.
const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only');

const registerCommunitySchema = z.object({
  body: z.object({
    community: z.object({
      name: z.string().min(2),
      slug: slugSchema.optional(),
      address: z.string().optional(),
      contactInfo: z.string().optional(),
    }),
    admin: z.object({
      fullName: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8),
    }),
  }),
});

const registerResidentSchema = z.object({
  body: z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    unitNumber: z.string().min(1),
  }),
});

const loginSchema = z.object({
  body: z.object({
    // Accepts either an email address or a phone number in the same field.
    identifier: z.string().min(3),
    password: z.string().min(1),
    // Set by the frontend when the login page was loaded from a
    // community's subdomain (acme.oudaa.app). When present, the
    // authenticated user must belong to that exact community — see
    // authController.login — so someone can't accidentally (or
    // deliberately) sign in to the wrong tenant's portal.
    communitySlug: z.string().optional(),
  }),
});

const refreshSchema = z.object({
  // The refresh token normally comes from the httpOnly cookie, not the
  // body, and the client may call this with no body/Content-Type at all
  // (e.g. a bare `fetch(url, { method: 'POST' })`). Without .optional()
  // here, express.json() leaving req.body as `undefined` (no JSON
  // Content-Type header present) fails validation before the cookie is
  // ever checked.
  body: z
    .object({
      refreshToken: z.string().min(10).optional(),
    })
    .optional(),
});

const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  }),
});

const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email(),
  }),
});

const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(10),
    newPassword: z.string().min(8),
  }),
});

module.exports = {
  registerCommunitySchema,
  registerResidentSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
