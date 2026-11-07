const express = require('express');
const router = express.Router();
const popupConfigController = require('../controllers/popupConfigController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/', popupConfigController.get);
router.put('/', authMiddleware, popupConfigController.update);

module.exports = router;
