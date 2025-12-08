import express from 'express';
import { body } from 'express-validator';
import {
  getTags,
  getTagById,
  createTag,
  updateTag,
  deleteTag,
  getTagUsage
} from '../controllers/tag.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Tag validation
const tagValidation = [
  body('nombre').notEmpty().trim().withMessage('El nombre es requerido'),
  body('descripcion').optional().trim(),
  body('color').optional().trim(),
  body('activa').optional().isBoolean()
];

// Admin routes - todas requieren autenticación y rol admin
router.get('/', authenticate, requireAdmin, getTags);
router.get('/:id', authenticate, requireAdmin, getTagById);
router.get('/:id/usage', authenticate, requireAdmin, getTagUsage);
router.post('/', authenticate, requireAdmin, tagValidation, createTag);
router.put('/:id', authenticate, requireAdmin, tagValidation, updateTag);
router.delete('/:id', authenticate, requireAdmin, deleteTag);

export default router;

