import express from 'express';
import { getPublicKey, subscribe, unsubscribe } from '../controllers/push.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

/* Cualquier sesión puede suscribirse, también una cuenta pendiente: así le
   llega el aviso de que la aprobaron. */
router.get('/public-key', authenticate, getPublicKey);
router.post('/subscribe', authenticate, subscribe);
router.delete('/subscribe', authenticate, unsubscribe);

export default router;
