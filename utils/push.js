import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.model.js';

/**
 * Notificaciones push (Web Push con claves VAPID, sin servicios pagos).
 *
 * - Con VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY: envía de verdad.
 * - En tests: acumula en memoria (`__sentPushes`).
 * - Sin claves: loguea y no manda nada.
 *
 * Como el email, nunca lanza. Las suscripciones que el navegador dio de baja
 * (404/410) se borran solas.
 *
 * Payload: { title, body, url, tag?, actions?: [{ action, title, url }] }.
 * `url` es adónde lleva tocar la notificación; cada acción lleva a la suya.
 */

const sent = [];

/** Sólo para tests: los "envíos" del transporte en memoria. */
export const __sentPushes = sent;

export const pushPublicKey = () => process.env.VAPID_PUBLIC_KEY || null;

let configured = false;
const configure = () => {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:notificaciones@casamalka.org',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
};

async function sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 }
    );
    return true;
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      await PushSubscription.deleteOne({ _id: sub._id });
    } else {
      console.error('Error enviando push:', error.statusCode || '', error.body || error.message);
    }
    return false;
  }
}

/** Manda la notificación a todos los dispositivos de esas personas. Devuelve cuántos la aceptaron. */
export async function sendPushToUsers(userIds, payload) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
  if (ids.length === 0) return 0;

  try {
    const subs = await PushSubscription.find({ userId: { $in: ids } });
    if (subs.length === 0) return 0;

    if (process.env.NODE_ENV === 'test') {
      subs.forEach((s) => sent.push({ userId: String(s.userId), ...payload }));
      return subs.length;
    }

    if (!configure()) {
      console.log(`🔕 [push deshabilitadas] "${payload.title}" → ${subs.length} dispositivo(s)`);
      return 0;
    }

    const results = await Promise.all(subs.map((s) => sendToSubscription(s, payload)));
    return results.filter(Boolean).length;
  } catch (error) {
    console.error('Error enviando push:', error.message);
    return 0;
  }
}

export const sendPushToUser = (userId, payload) => sendPushToUsers([userId], payload);
