import express from 'express';
import { getHoy } from '../controllers/hoy.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Lo pendiente del equipo, para el panel.
router.get('/', authenticate, requireAdmin, getHoy);

export default router;
