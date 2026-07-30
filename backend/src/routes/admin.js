'use strict';
const router = require('express').Router();
const {
  getDashboard, getUserList, suspendUser,
  getMissionaryOverview, getStakesOverview,
} = require('../controllers/adminController');
const { authenticate, requireApproved, requireRole } = require('../middleware/auth');

const denyAdminRoles = new Set([
  'stake_presidency',
  'mission_president',
  'mission_president_wife',
]);

const blockRestrictedAdminRoles = (req, res, next) => {
  const role = (req.user?.role || '').toLowerCase();
  if (denyAdminRoles.has(role)) {
    return res.status(403).json({ error: 'Admin access is not available for this role' });
  }
  return next();
};

// All admin routes require authentication + approval + minimum bishop role
router.use(authenticate, requireApproved);
router.use(blockRestrictedAdminRoles);
router.use(requireRole(
  'BISHOP', 'DISTRICT_PRESIDENT', 'STAKE_PRESIDENT', 'COORDINATING_COUNCIL_LEADER',
  'AREA_AUTHORITY', 'AREA_PRESIDENCY', 'GENERAL_AUTHORITY', 'APOSTLE', 'FIRST_PRESIDENCY'
));

router.get('/dashboard',           getDashboard);
router.get('/users',               getUserList);
router.patch('/users/:id/suspend', suspendUser);
router.get('/missionary/overview', getMissionaryOverview);
router.get('/stakes',              getStakesOverview);

module.exports = router;
