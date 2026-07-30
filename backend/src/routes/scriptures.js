'use strict';
const router = require('express').Router();
const { getCurrentScripture, getRandomScripture } = require('../controllers/scriptureController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);
router.get('/current', getCurrentScripture);
router.get('/random', getRandomScripture);

module.exports = router;
