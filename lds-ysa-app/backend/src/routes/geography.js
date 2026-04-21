'use strict';
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const {
  getAreas, getStakes, getMissions, getDistricts,
  createStake, renameStake, deleteStake,
  createDistrict, renameDistrict, deleteDistrict,
} = require('../controllers/geographyController');

// Public GET — needed during registration before login
router.get('/areas',     getAreas);
router.get('/stakes',    getStakes);
router.get('/missions',  getMissions);
router.get('/districts', getDistricts);

// Public POST — leaders register / find-or-create their stake or district during sign-up
router.post('/stakes',    createStake);
router.post('/districts', createDistrict);

// Protected — admin / senior leaders can rename or delete
const seniorLeader = authenticate, seniorRole = requireRole(
  'it_support', 'area_presidency', 'area_authority', 'general_authority',
  'apostle', 'first_presidency', 'mission_president', 'stake_presidency'
);
router.patch ('/stakes/:id',    seniorLeader, seniorRole, renameStake);
router.delete('/stakes/:id',    seniorLeader, requireRole('it_support'), deleteStake);
router.patch ('/districts/:id', seniorLeader, seniorRole, renameDistrict);
router.delete('/districts/:id', seniorLeader, requireRole('it_support'), deleteDistrict);

module.exports = router;
