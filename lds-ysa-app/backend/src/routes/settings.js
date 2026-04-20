'use strict';
const router = require('express').Router();
const {
  getSettings, updateNotificationSettings,
  updatePrivacySettings, updateProfileSettings, deleteAccount,
} = require('../controllers/settingsController');
const { authenticate, requireApproved } = require('../middleware/auth');

router.use(authenticate);
router.get('/',                     getSettings);
router.patch('/notifications',      updateNotificationSettings);
router.patch('/privacy',            requireApproved, updatePrivacySettings);
router.patch('/profile',            updateProfileSettings);
router.delete('/account',           deleteAccount);

module.exports = router;
