import express from 'express';
import { createGasto, deleteGasto, getGasto, listGastos, updateGasto } from '../controllers/gasto.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Sólo el equipo: los gastos no los ve ningún participante.
router.use(authenticate, requireAdmin);
router.get('/', listGastos);
router.get('/:id', getGasto);
router.post('/', createGasto);
router.put('/:id', updateGasto);
router.delete('/:id', deleteGasto);

export default router;
