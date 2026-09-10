const express = require('express');
const ctrl = require('../controllers/userController');
const authenticate = require('../middleware/authenticate');
const { avatarUpload } = require('../config/upload');

const router = express.Router();

router.use(authenticate);

router.patch('/me/preferences', ctrl.updatePreferences);
router.post('/me/otp/request', ctrl.requestProfileOtp);
router.post('/me/otp/verify-phone', ctrl.verifyPhoneOtp);
router.post('/me/avatar', avatarUpload.single('avatar'), ctrl.uploadAvatar);
router.delete('/me/avatar', ctrl.deleteAvatar);

module.exports = router;
