import express from 'express';
import { body } from 'express-validator';
import { register, login, getCurrentUser } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

// Validation rules
const registerValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('nombre').notEmpty().trim(),
  body('apellido').notEmpty().trim(),
  body('dni')
    .notEmpty()
    .trim()
    .matches(/^\d{7,10}$/)
    .withMessage('El DNI debe tener entre 7 y 10 dígitos'),
  body('telefono').notEmpty().trim().isLength({ min: 8, max: 22 }),
  body('tags').optional().isArray(),
  body('restriccionesAlimentarias').optional().isArray(),
  body('comoSeEntero').optional().trim()
];

const loginValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
];

router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.get('/me', authenticate, getCurrentUser);

export default router;

