import express from 'express';
import { IDIOMAS, RESIDENCIAS } from '../models/User.model.js';
import { TIPOS_DOCUMENTO, validarDocumentoAlta } from '../utils/documento.js';
import { body } from 'express-validator';
import { register, login, getCurrentUser, getRegistroWhatsapp } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { assertValidBirthDate } from '../utils/calendarDate.js';

const router = express.Router();

// Validation rules
const registerValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('nombre').notEmpty().trim(),
  body('apellido').notEmpty().trim(),
  body('tipoDocumento').optional().isIn(TIPOS_DOCUMENTO),
  body('dni').notEmpty().custom(validarDocumentoAlta),
  body('telefono').notEmpty().trim().isLength({ min: 8, max: 22 }),
  body('fechaNacimiento')
    .notEmpty()
    .withMessage('La fecha de nacimiento es requerida')
    .custom((value) => {
      assertValidBirthDate(value);
      return true;
    }),
  body('tags').optional().isArray(),
  body('restriccionesAlimentarias').optional().isArray(),
  body('comoSeEntero').optional().trim(),
  body('nacionalidad').trim().toUpperCase().isISO31661Alpha2().withMessage('Elegí tu nacionalidad'),
  body('residencia').isIn(RESIDENCIAS).withMessage('Contanos dónde vivís'),
  body('idioma').optional().isIn(IDIOMAS),
  body('ciudad')
    .trim()
    .isLength({ max: 80 })
    .custom((ciudad, { req }) => {
      if (req.body.residencia !== 'buenos_aires' && !ciudad) throw new Error('Contanos en qué ciudad vivís');
      return true;
    })
];

const loginValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
];

router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.get('/me', authenticate, getCurrentUser);
router.get('/registro-whatsapp', authenticate, getRegistroWhatsapp);

export default router;

