import express from 'express';
import { body } from 'express-validator';
import {
  getPendingUsers,
  approveUser,
  rejectUser,
  updateUser,
  updateMyProfile,
  getAllUsers,
  getUserById,
  getUsersByTags
} from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// User update validation
const updateUserValidation = [
  body('nombre').optional().notEmpty().trim(),
  body('apellido').optional().notEmpty().trim(),
  body('dni').optional().trim().matches(/^\d{7,10}$/),
  body('telefono').optional().trim(),
  body('tags').optional().isArray(),
  body('tagsPrivados').optional().isArray(),
  body('estado').optional().isIn(['pending', 'approved', 'rejected']),
  body('restriccionesAlimentarias').optional().isArray(),
  body('comoSeEntero').optional().trim()
];

const myProfileValidation = [
  body('nombre').optional().notEmpty().trim(),
  body('apellido').optional().notEmpty().trim(),
  body('dni').optional().trim().matches(/^\d{7,10}$/),
  body('telefono').optional().trim().isLength({ min: 8, max: 22 }),
  body('tags').optional().isArray(),
  body('restriccionesAlimentarias').optional().isArray(),
  body('comoSeEntero').optional().trim()
];

// Admin routes
router.get('/pending', authenticate, requireAdmin, getPendingUsers);
router.get('/', authenticate, requireAdmin, getAllUsers);
router.get('/tags', authenticate, requireAdmin, getUsersByTags);

// Participante: mismo handler para onboarding (front) y PATCH /me
router.post('/onboarding', authenticate, myProfileValidation, updateMyProfile);
router.patch('/me', authenticate, myProfileValidation, updateMyProfile);

router.get('/:id', authenticate, requireAdmin, getUserById);
router.put('/:id/approve', authenticate, requireAdmin, approveUser);
router.put('/:id/reject', authenticate, requireAdmin, rejectUser);
router.put('/:id', authenticate, requireAdmin, updateUserValidation, updateUser);

export default router;

