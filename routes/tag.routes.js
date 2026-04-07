import express from 'express';
import { body } from 'express-validator';
import {
  getTags,
  getTagById,
  createTag,
  updateTag,
  deleteTag
} from '../controllers/tag.controller.js';
import { authenticate, authenticateOptional, requireAdmin } from '../middleware/auth.middleware.js';

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

// Catálogo público: sin token devuelve solo activas; con admin autenticado permite filtrar todas.
router.get('/', authenticateOptional, getTags);
router.get('/:id', authenticate, getTagById);
router.post('/', authenticate, requireAdmin, tagValidation, createTag);
router.put('/:id', authenticate, requireAdmin, tagUpdateValidation, updateTag);
router.delete('/:id', authenticate, requireAdmin, deleteTag);

export default router;

