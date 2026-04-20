'use strict';
const router = require('express').Router();
const {
  activateMissionaryMode, deactivateMissionaryMode,
  getMissionMembers, getAllMissionPresidents
} = require('../controllers/missionaryController');
const { authenticate, requireApproved } = require('../middleware/auth');

router.use(authenticate, requireApproved);
router.post('/activate', activateMissionaryMode);
router.post('/deactivate', deactivateMissionaryMode);
router.get('/presidents', getAllMissionPresidents);
router.get('/mission/:mission_id/members', getMissionMembers);

module.exports = router;
