'use strict';
const router = require('express').Router({ mergeParams: true });
const { addReaction, removeReaction, getReactions } = require('../controllers/reactionController');
const { authenticate, requireApproved } = require('../middleware/auth');
router.use(authenticate, requireApproved);
router.get('/',           getReactions);
router.post('/',          addReaction);
router.delete('/:emoji',  removeReaction);
module.exports = router;
