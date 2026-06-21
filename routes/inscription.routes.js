import express from 'express';
import {
  createInscription,
  getMyInscriptions,
  cancelInscription,
  getActivityInscriptions,
  approveInscription,
  rejectInscription,
  getAllInscriptions,
  countAcceptedInscriptionsLast30Days,
  getAvailableDates,
  getUserActivityInscriptions,
  updateInscriptionStatus,
  approvePayment,
  rejectPayment,
  updateComprobante,
  getPendingPaymentInscriptions,
  getComprobanteFile
} from '../controllers/inscription.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireAdmin, requireApproved } from '../middleware/auth.middleware.js';
import { uploadComprobante, handleUploadError } from '../middleware/upload.middleware.js';

const router = express.Router();

// Participant routes
router.get('/activity/:activityId/available-dates', authenticate, requireApproved, getAvailableDates);
router.get('/activity/:activityId/user-inscriptions', authenticate, requireApproved, getUserActivityInscriptions);
router.post(
  '/',
  authenticate,
  requireApproved,
  uploadComprobante.single('comprobante'),
  handleUploadError,
  createInscription
);
router.get('/my', authenticate, requireApproved, getMyInscriptions);
router.put('/:id/cancel', authenticate, requireApproved, cancelInscription);
router.put(
  '/:id/comprobante',
  authenticate,
  requireApproved,
  uploadComprobante.single('comprobante'),
  handleUploadError,
  updateComprobante
);

// Admin routes
router.get('/stats/accepted-last-30-days', authenticate, requireAdmin, countAcceptedInscriptionsLast30Days);
router.get('/pending-payments', authenticate, requireAdmin, getPendingPaymentInscriptions);
router.get('/', authenticate, requireAdmin, getAllInscriptions);
router.get('/activity/:activityId', authenticate, requireAdmin, getActivityInscriptions);
router.put('/:id/approve', authenticate, requireAdmin, approveInscription);
router.put('/:id/reject', authenticate, requireAdmin, rejectInscription);
router.put('/:id/status', authenticate, requireAdmin, updateInscriptionStatus);
router.put('/:id/payment/approve', authenticate, requireAdmin, approvePayment);
router.put('/:id/payment/reject', authenticate, requireAdmin, rejectPayment);
router.get('/:id/comprobante/file', authenticate, requireAdmin, getComprobanteFile);

export default router;
