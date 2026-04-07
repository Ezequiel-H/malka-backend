import express from 'express';
import { body } from 'express-validator';
import {
  getTags,
  getTagById,
  createTag,
  updateTag,
  deleteTag
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

const tagUpdateValidation = [
  body('nombre').optional().notEmpty().trim(),
  body('descripcion').optional().trim(),
  body('color').optional().trim(),
  body('activa').optional().isBoolean()
];

// Admin routes - todas requieren autenticación y rol admin
router.get('/', authenticate, requireAdmin, getTags);
router.get('/:id', authenticate, requireAdmin, getTagById);
router.post('/', authenticate, requireAdmin, tagValidation, createTag);
router.put('/:id', authenticate, requireAdmin, tagUpdateValidation, updateTag);
router.delete('/:id', authenticate, requireAdmin, deleteTag);

export default router;

