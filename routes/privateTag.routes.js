import express from 'express';
import { body } from 'express-validator';
import {
  getPrivateTags,
  getPrivateTagById,
  createPrivateTag,
  updatePrivateTag,
  deletePrivateTag
} from '../controllers/privateTag.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

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

router.get('/', authenticate, requireAdmin, getPrivateTags);
router.get('/:id', authenticate, requireAdmin, getPrivateTagById);
router.post('/', authenticate, requireAdmin, tagValidation, createPrivateTag);
router.put('/:id', authenticate, requireAdmin, tagUpdateValidation, updatePrivateTag);
router.delete('/:id', authenticate, requireAdmin, deletePrivateTag);

export default router;
