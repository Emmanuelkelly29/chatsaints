'use strict';
const router = require('express').Router();
const { getAreas, getStakes, getMissions, getDistricts } = require('../controllers/geographyController');
// Geography endpoints are public — needed during registration before login
router.get('/areas',     getAreas);
router.get('/stakes',    getStakes);
router.get('/missions',  getMissions);
router.get('/districts', getDistricts);
module.exports = router;
