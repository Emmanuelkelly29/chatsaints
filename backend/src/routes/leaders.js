'use strict';
const router = require('express').Router();
const { getPendingApprovals, approveLeader, rejectLeader, approveStakePoolMember } = require('../controllers/leaderController');
const { authenticate, requireApproved } = require('../middleware/auth');

router.use(authenticate, requireApproved);
router.get('/approvals', getPendingApprovals);
router.post('/approvals/:id/approve', approveLeader);
router.post('/approvals/:id/reject', rejectLeader);
router.post('/stake-pool/approve/:userId', approveStakePoolMember);

module.exports = router;
