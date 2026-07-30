'use strict';
const router = require('express').Router();
const { getMe, searchUsers, getUserById, updateProfile, getStakePool } = require('../controllers/userController');
const { authenticate, requireApproved } = require('../middleware/auth');

router.use(authenticate);
router.get('/me', getMe);
router.patch('/me', updateProfile);
router.get('/search', requireApproved, searchUsers);
router.get('/stake-pool', requireApproved, getStakePool);
router.get('/:id', requireApproved, getUserById);

module.exports = router;
