import express from 'express';
import { body } from 'express-validator';
import {
  createActivity,
  getActivities,
  getActivityById,
  updateActivity,
  deleteActivity,
  exportInscriptionsToExcel
} from '../controllers/activity.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Activity validation
const activityValidation = [
  body('titulo').notEmpty().trim(),
  body('descripcion').notEmpty().trim(),
  body('tipo').isIn(['unica', 'recurrente']),
  body('estado').optional().isIn(['borrador', 'publicada', 'eliminada'])
];

// Public routes (approved users can view published activities)
router.get('/', authenticate, getActivities);
router.get('/:id', authenticate, getActivityById);

// Admin routes
router.post('/', authenticate, requireAdmin, activityValidation, createActivity);
router.put('/:id', authenticate, requireAdmin, activityValidation, updateActivity);
router.delete('/:id', authenticate, requireAdmin, deleteActivity);
router.get('/:id/export', authenticate, requireAdmin, exportInscriptionsToExcel);

export default router;

