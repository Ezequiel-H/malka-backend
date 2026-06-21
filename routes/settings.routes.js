import express from 'express';
import { getSettings, updateSettings } from '../controllers/settings.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', authenticate, requireAdmin, getSettings);
router.put('/', authenticate, requireAdmin, updateSettings);

export default router;
