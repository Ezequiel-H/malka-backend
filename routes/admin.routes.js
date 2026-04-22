import express from 'express';
import {
  getFirstInscriptionRepeatStats,
  getInscriptionStats
} from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/inscription-stats', authenticate, requireAdmin, getInscriptionStats);
router.get(
  '/first-inscription-repeat-stats',
  authenticate,
  requireAdmin,
  getFirstInscriptionRepeatStats
);

export default router;
