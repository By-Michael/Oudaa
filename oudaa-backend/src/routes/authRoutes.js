const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const {
  registerCommunitySchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require('../validators/authValidators');

const router = express.Router();

// Throttle auth endpoints to blunt credential-stuffing / brute force.
// Same production-only-strict pattern as the general limiter in app.js —
// a real test suite legitimately fires far more than 20 auth requests
// against the same IP inside one 15-minute window, so the strict cap only
// applies in production.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later' },
});

router.post(
  '/register-community',
  authLimiter,
  validate(registerCommunitySchema),
  authController.registerCommunity
);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authLimiter, validate(refreshSchema), authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);
router.patch(
  '/change-password',
  authenticate,
  authLimiter,
  validate(changePasswordSchema),
  authController.changePassword
);
// Unauthenticated by nature (that's the point of "forgot" password) —
// authLimiter throttles both against brute-forcing/enumerating emails and
// against mail-bombing an inbox with reset requests.
router.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);
router.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);

module.exports = router;
