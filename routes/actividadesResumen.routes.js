import express from 'express';
import { getActividadesResumen } from '../controllers/actividadesResumen.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// La lista de actividades del equipo, con el próximo encuentro y la semana.
router.get('/', authenticate, requireAdmin, getActividadesResumen);

export default router;
