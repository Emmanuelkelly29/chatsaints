'use strict';
const router = require('express').Router();
const {
  createStatus, getStatusFeed, getMyStatuses,
  viewStatus, deleteStatus, updateStatusSettings,
  getStatusViewers,
} = require('../controllers/statusController');
const { authenticate, requireApproved } = require('../middleware/auth');

router.use(authenticate, requireApproved);

router.get('/feed',         getStatusFeed);         // All contacts' statuses
router.get('/mine',         getMyStatuses);          // My own statuses + viewers
router.post('/',            createStatus);           // Post a new status
router.post('/:id/view',    viewStatus);             // Record a view (stealth optional)
router.get('/:id/viewers',  getStatusViewers);       // Owner sees who viewed
router.delete('/:id',       deleteStatus);           // Delete own status
router.patch('/settings',   updateStatusSettings);   // Stealth + default visibility prefs

module.exports = router;
