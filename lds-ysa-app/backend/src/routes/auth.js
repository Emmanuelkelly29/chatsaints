'use strict';
const router = require('express').Router();
const { register, login, updatePushToken, sendOtp, verifyOtp } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.patch('/push-token', authenticate, updatePushToken);

module.exports = router;
