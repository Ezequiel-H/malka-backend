import express from 'express';
import { getMiResumen } from '../controllers/miResumen.controller.js';
import { authenticate, requireApproved } from '../middleware/auth.middleware.js';

const router = express.Router();

// Lo de quien está logueado, para su inicio.
router.get('/resumen', authenticate, requireApproved, getMiResumen);

export default router;
