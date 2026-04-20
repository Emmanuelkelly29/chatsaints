'use strict';
const router = require('express').Router();
const {
  listConversations, createConversation, getMessages,
  pinConversation, unpinConversation, getPinnedConversations, findOrCreate1on1
} = require('../controllers/conversationController');
const { authenticate, requireApproved } = require('../middleware/auth');

router.use(authenticate, requireApproved);
router.get('/', listConversations);
router.post('/', createConversation);
router.post('/1on1', findOrCreate1on1);
router.get('/pinned', getPinnedConversations);
router.get('/:id/messages', getMessages);
router.post('/:id/pin', pinConversation);
router.delete('/:id/pin', unpinConversation);

module.exports = router;
