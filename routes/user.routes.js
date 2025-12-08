import express from 'express';
import { body } from 'express-validator';
import {
  getPendingUsers,
  approveUser,
  rejectUser,
  updateUser,
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
  body('telefono').optional().trim(),
  body('tags').optional().isArray()
];

// Admin routes
router.get('/pending', authenticate, requireAdmin, getPendingUsers);
router.get('/', authenticate, requireAdmin, getAllUsers);
router.get('/tags', authenticate, requireAdmin, getUsersByTags);
router.get('/:id', authenticate, requireAdmin, getUserById);
router.put('/:id/approve', authenticate, requireAdmin, approveUser);
router.put('/:id/reject', authenticate, requireAdmin, rejectUser);
router.put('/:id', authenticate, requireAdmin, updateUserValidation, updateUser);

export default router;

