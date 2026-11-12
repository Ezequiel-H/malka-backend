import express from 'express';
import { IDIOMAS, RESIDENCIAS } from '../models/User.model.js';
import { body } from 'express-validator';
import {
  getPendingUsers,
  approveUser,
  rejectUser,
  updateUser,
  updateMyProfile,
  getAllUsers,
  getUserById,
  getUsersByTags,
  changeUserPassword
} from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { assertValidBirthDate } from '../utils/calendarDate.js';

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
  body('fechaNacimiento')
    .optional()
    .custom((value) => {
      if (value === '' || value == null) return true;
      assertValidBirthDate(value);
      return true;
    }),
  body('tags').optional().isArray(),
  body('restriccionesAlimentarias').optional().isArray(),
  body('comoSeEntero').optional().trim(),
  body('nacionalidad').optional().trim().toUpperCase().isISO31661Alpha2(),
  body('residencia').optional().isIn(RESIDENCIAS),
  body('ciudad').optional().trim().isLength({ max: 80 }),
  body('idioma').optional().isIn(IDIOMAS)
];

const adminSetPasswordValidation = [body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres')];

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
router.put(
  '/:id/password',
  authenticate,
  requireAdmin,
  adminSetPasswordValidation,
  changeUserPassword
);
router.put('/:id', authenticate, requireAdmin, updateUserValidation, updateUser);

export default router;

