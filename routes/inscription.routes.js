import express from 'express';
import {
  createInscription,
  getMyInscriptions,
  cancelInscription,
  getActivityInscriptions,
  approveInscription,
  rejectInscription,
  getAllInscriptions,
  getAvailableDates,
  getUserActivityInscriptions,
  updateInscriptionStatus
} from '../controllers/inscription.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireAdmin, requireApproved } from '../middleware/auth.middleware.js';

const router = express.Router();

// Participant routes
router.get('/activity/:activityId/available-dates', authenticate, requireApproved, getAvailableDates);
router.get('/activity/:activityId/user-inscriptions', authenticate, requireApproved, getUserActivityInscriptions);
router.post('/', authenticate, requireApproved, createInscription);
router.get('/my', authenticate, requireApproved, getMyInscriptions);
router.put('/:id/cancel', authenticate, requireApproved, cancelInscription);

// Admin routes
router.get('/', authenticate, requireAdmin, getAllInscriptions);
router.get('/activity/:activityId', authenticate, requireAdmin, getActivityInscriptions);
router.put('/:id/approve', authenticate, requireAdmin, approveInscription);
router.put('/:id/reject', authenticate, requireAdmin, rejectInscription);
router.put('/:id/status', authenticate, requireAdmin, updateInscriptionStatus);

export default router;

