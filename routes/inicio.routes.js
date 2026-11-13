import express from 'express';
import { borrarInicio, getInicio, guardarInicio } from '../controllers/inicio.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// El Panel a medida de cada persona del equipo.
router.use(authenticate, requireAdmin);
router.get('/', getInicio);
router.put('/', guardarInicio);
router.delete('/', borrarInicio);

export default router;
