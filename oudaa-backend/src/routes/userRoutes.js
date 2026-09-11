const express = require('express');
const ctrl = require('../controllers/userController');
const authenticate = require('../middleware/authenticate');
const { avatarUpload } = require('../config/upload');
const { otpRequestLimiter, otpVerifyLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.use(authenticate);

router.patch('/me/preferences', ctrl.updatePreferences);
router.post('/me/otp/request', otpRequestLimiter, ctrl.requestProfileOtp);
router.post('/me/otp/verify-phone', otpVerifyLimiter, ctrl.verifyPhoneOtp);
// Also goes through otpVerifyLimiter: residents' OTP is checked inline
// inside uploadAvatar itself (see userController.uploadAvatar), so this
// route needs the same backstop against rapid-fire guessing as the
// dedicated verify endpoint above. Committee (ADMIN) uploads skip the
// OTP check entirely but still pass through this limiter harmlessly.
router.post('/me/avatar', otpVerifyLimiter, avatarUpload.single('avatar'), ctrl.uploadAvatar);
router.delete('/me/avatar', ctrl.deleteAvatar);

module.exports = router;
