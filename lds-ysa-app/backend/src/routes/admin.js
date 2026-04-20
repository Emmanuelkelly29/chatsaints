'use strict';
const router = require('express').Router();
const {
  getDashboard, getUserList, suspendUser,
  getMissionaryOverview, getStakesOverview,
} = require('../controllers/adminController');
const { authenticate, requireApproved, requireRole } = require('../middleware/auth');

// All admin routes require authentication + approval + minimum bishop role
router.use(authenticate, requireApproved);
router.use(requireRole(
  'BISHOP', 'DISTRICT_PRESIDENT', 'STAKE_PRESIDENT', 'COORDINATING_COUNCIL_LEADER',
  'MISSION_PRESIDENT', 'MISSION_PRESIDENT_WIFE',
  'AREA_AUTHORITY', 'AREA_PRESIDENCY', 'GENERAL_AUTHORITY', 'APOSTLE', 'FIRST_PRESIDENCY'
));

router.get('/dashboard',           getDashboard);
router.get('/users',               getUserList);
router.patch('/users/:id/suspend', suspendUser);
router.get('/missionary/overview', getMissionaryOverview);
router.get('/stakes',              getStakesOverview);

module.exports = router;
