import PushSubscription from '../models/PushSubscription.model.js';
import { pushPublicKey } from '../utils/push.js';

/** Clave pública VAPID: el navegador la necesita para suscribirse. */
export const getPublicKey = (req, res) => {
  res.json({ publicKey: pushPublicKey() });
};

/**
 * Guarda (o reasigna) la suscripción de este dispositivo a quien tiene la
 * sesión. Si el dispositivo estaba a nombre de otra persona (otra cuenta en
 * el mismo navegador), pasa a la actual: las notificaciones son de quien
 * está usando el dispositivo ahora.
 */
export const subscribe = async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (
      typeof endpoint !== 'string' ||
      !/^https:\/\//.test(endpoint) ||
      typeof keys?.p256dh !== 'string' ||
      typeof keys?.auth !== 'string'
    ) {
      return res.status(400).json({ message: 'Suscripción inválida' });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        userId: req.user._id,
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: String(req.get('user-agent') || '').slice(0, 300)
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ message: 'Notificaciones activadas' });
  } catch (error) {
    console.error('Error al guardar la suscripción push:', error);
    res.status(500).json({ message: 'Error al activar las notificaciones' });
  }
};

/** Da de baja este dispositivo (sólo si es de quien tiene la sesión). */
export const unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (typeof endpoint !== 'string') {
      return res.status(400).json({ message: 'Falta el endpoint' });
    }
    await PushSubscription.deleteOne({ endpoint, userId: req.user._id });
    res.json({ message: 'Notificaciones desactivadas' });
  } catch (error) {
    console.error('Error al borrar la suscripción push:', error);
    res.status(500).json({ message: 'Error al desactivar las notificaciones' });
  }
};
