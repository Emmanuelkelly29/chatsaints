'use strict';
const router = require('express').Router();
const { createOrJoinRoom, leaveRoom, getActiveRoom } = require('../controllers/videoController');
const { authenticate, requireApproved } = require('../middleware/auth');
router.use(authenticate, requireApproved);
router.post('/rooms',                          createOrJoinRoom);
router.post('/rooms/:roomId/leave',            leaveRoom);
router.get('/rooms/:conversationId/active',    getActiveRoom);
module.exports = router;
