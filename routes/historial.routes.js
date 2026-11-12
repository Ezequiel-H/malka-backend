import express from 'express';
import multer from 'multer';
import {
  borrarContacto,
  borrarVisita,
  buscarPersonas,
  crearContacto,
  crearVisita,
  editarContacto,
  editarVisita,
  importarPlanilla,
  listarHistorial,
  verContacto,
} from '../controllers/historial.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

/* La planilla se lee en memoria: hasta 10 MB alcanza para años de historial. */
const subirPlanilla = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('archivo');

// Sólo el equipo: el historial tiene datos de personas que no son participantes.
router.use(authenticate, requireAdmin);
router.get('/', listarHistorial);
router.post('/', crearVisita);
router.get('/personas', buscarPersonas);
router.post('/importar', subirPlanilla, importarPlanilla);
router.post('/contactos', crearContacto);
router.get('/contactos/:id', verContacto);
router.put('/contactos/:id', editarContacto);
router.delete('/contactos/:id', borrarContacto);
router.put('/:id', editarVisita);
router.delete('/:id', borrarVisita);

export default router;
