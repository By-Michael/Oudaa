'use strict';
const express = require('express');
const controller = require('../controllers/platformAdmin/platformAnnouncementController');
const authenticate = require('../middleware/authenticate');
const router = express.Router();
router.get('/active', authenticate, controller.activeForCommunity);
module.exports = router;
