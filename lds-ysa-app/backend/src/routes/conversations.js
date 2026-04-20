'use strict';
const router = require('express').Router();
const {
  listConversations, createConversation, getMessages,
  pinConversation, unpinConversation, getPinnedConversations
} = require('../controllers/conversationController');
const { authenticate, requireApproved } = require('../middleware/auth');

router.use(authenticate, requireApproved);
router.get('/', listConversations);
router.post('/', createConversation);
router.get('/pinned', getPinnedConversations);
router.get('/:id/messages', getMessages);
router.post('/:id/pin', pinConversation);
router.delete('/:id/pin', unpinConversation);

module.exports = router;
