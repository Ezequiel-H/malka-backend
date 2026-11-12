import express from 'express';
import {
  getFirstInscriptionRepeatStats,
  getInscriptionStats,
  getMetrics,
  getPeopleMetrics,
  getUserMetrics,
  getUpcomingBirthdays
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
router.get('/birthdays', authenticate, requireAdmin, getUpcomingBirthdays);
router.get('/metrics', authenticate, requireAdmin, getMetrics);
router.get('/metrics/people', authenticate, requireAdmin, getPeopleMetrics);
router.get('/users/:id/metrics', authenticate, requireAdmin, getUserMetrics);

export default router;
