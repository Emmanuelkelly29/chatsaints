'use strict';

const router = require('express').Router();
const {
  listContactRequests,
  createContactRequest,
  acceptContactRequest,
  declineContactRequest,
} = require('../controllers/contactRequestController');
const { authenticate, requireApproved } = require('../middleware/auth');

router.use(authenticate, requireApproved);
router.get('/', listContactRequests);
router.post('/', createContactRequest);
router.post('/:id/accept', acceptContactRequest);
router.post('/:id/decline', declineContactRequest);

module.exports = router;