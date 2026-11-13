import { DateTime } from 'luxon';
import Activity from '../models/Activity.model.js';
import Inscription from '../models/Inscription.model.js';
import User from '../models/User.model.js';
import Settings from '../models/Settings.model.js';
import PushSubscription from '../models/PushSubscription.model.js';
import { participantCanViewActivity } from './participantActivityAccess.js';
import { calculateOccurrences } from './generateOccurrences.js';
import { sendPushToUser, sendPushToUsers } from './push.js';

/**
 * Avisos que sólo van por push (no por email): actividad nueva y
 * recordatorio del día. Llegan sólo a participantes aprobados que activaron
 * las notificaciones y que pueden ver la actividad (tags privados).
 */

const ZONA = 'America/Argentina/Buenos_Aires';

/* Hora (Argentina) a partir de la cual sale el recordatorio del día. */
export const HORA_RECORDATORIO = 10;

/** Participantes aprobados con al menos un dispositivo suscripto. */
async function suscriptos() {
  const ids = await PushSubscription.distinct('userId');
  if (ids.length === 0) return [];
  return User.find({ _id: { $in: ids }, role: 'participant', estado: 'approved' }).select(
    'role tagsPrivados'
  );
}

/** Actividad nueva publicada: a quien la puede ver. */
export async function notifyNewActivity(activity) {
  try {
    if (activity.estado !== 'publicada') return 0;
    const destinatarios = (await suscriptos()).filter((u) => participantCanViewActivity(u, activity));
    if (destinatarios.length === 0) return 0;

    const url = `/activities/${activity._id}`;
    return sendPushToUsers(
      destinatarios.map((u) => u._id),
      {
        title: 'Nueva actividad en Malka',
        body: activity.titulo,
        url,
        tag: `actividad-${activity._id}`,
        actions: [{ action: 'anotarme', title: 'Ver y anotarme', url }]
      }
    );
  } catch (error) {
    console.error('Error avisando la actividad nueva:', error.message);
    return 0;
  }
}

/* ¿La actividad pasa hoy (fecha argentina `hoy`, YYYY-MM-DD)? Los viajes no:
   anotarse a un viaje el mismo día no tiene sentido. */
function pasaHoy(activity, hoy) {
  if (activity.tipo === 'unica') {
    return activity.fecha && DateTime.fromJSDate(activity.fecha, { zone: 'utc' }).toISODate() === hoy;
  }
  if (activity.tipo === 'recurrente') {
    if (activity.fecha && DateTime.fromJSDate(activity.fecha, { zone: 'utc' }).toISODate() > hoy) {
      return false;
    }
    try {
      // daysAhead 0: sólo la ocurrencia de hoy, si la hay.
      return calculateOccurrences(activity, 0).length > 0;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Recordatorio del día: a cada participante suscripto, las actividades de hoy
 * a las que NO está anotado, en una sola notificación. Respeta el
 * `recordatoriosAutomaticos` de cada actividad y saltea las que no tienen
 * cupo. Devuelve a cuántas personas se les mandó.
 */
export async function sendDailyReminders(hoy = DateTime.now().setZone(ZONA).toISODate()) {
  const candidatas = await Activity.find({
    estado: 'publicada',
    tipo: { $in: ['unica', 'recurrente'] },
    recordatoriosAutomaticos: { $ne: false }
  });
  const deHoy = candidatas.filter((a) => pasaHoy(a, hoy));
  if (deHoy.length === 0) return 0;

  const inicio = new Date(`${hoy}T00:00:00.000Z`);
  const fin = new Date(`${hoy}T23:59:59.999Z`);

  const inscripciones = await Inscription.find({
    activityId: { $in: deHoy.map((a) => a._id) },
    fecha: { $gte: inicio, $lte: fin },
    estado: { $ne: 'cancelada' }
  }).select('activityId userId estado');

  const conLugar = deHoy.filter((a) => {
    if (!a.cupo) return true;
    const ocupados = inscripciones.filter(
      (i) => String(i.activityId) === String(a._id) && ['pendiente', 'aceptada'].includes(i.estado)
    ).length;
    return ocupados < a.cupo;
  });
  if (conLugar.length === 0) return 0;

  const anotado = new Set(inscripciones.map((i) => `${i.userId}:${i.activityId}`));
  let enviados = 0;

  for (const user of await suscriptos()) {
    const paraEl = conLugar.filter(
      (a) => participantCanViewActivity(user, a) && !anotado.has(`${user._id}:${a._id}`)
    );
    if (paraEl.length === 0) continue;

    const una = paraEl.length === 1 ? paraEl[0] : null;
    const url = una ? `/activities/${una._id}` : '/activities';
    const hora = una ? una.recurrence?.hora || una.hora : null;

    await sendPushToUser(user._id, {
      title: una ? `Hoy: ${una.titulo}` : `Hoy hay ${paraEl.length} actividades en Malka`,
      body: una
        ? `${hora ? `A las ${hora}. ` : ''}Todavía no estás anotado/a, ¿te sumás?`
        : `${paraEl.map((a) => a.titulo).join(' · ')}. ¿Te sumás?`,
      url,
      tag: `recordatorio-${hoy}`,
      actions: [{ action: 'anotarme', title: una ? 'Ir a anotarme' : 'Ver actividades', url }]
    });
    enviados++;
  }

  return enviados;
}

/**
 * Corre el recordatorio una vez por día, desde las HORA_RECORDATORIO (hora
 * argentina). La marca del día vive en Settings y se toma con un update
 * atómico: aunque el server reinicie o haya dos instancias, sale una vez.
 */
export async function runDailyRemindersIfDue(now = DateTime.now().setZone(ZONA)) {
  if (now.hour < HORA_RECORDATORIO) return false;
  const hoy = now.toISODate();

  await Settings.getSettings();
  const tomado = await Settings.findOneAndUpdate(
    { ultimoRecordatorioPush: { $ne: hoy } },
    { ultimoRecordatorioPush: hoy }
  );
  if (!tomado) return false;

  const enviados = await sendDailyReminders(hoy);
  console.log(`🔔 Recordatorio del día ${hoy}: ${enviados} persona(s)`);
  return true;
}

/** Revisa cada 10 minutos si toca el recordatorio. Lo arranca server.js. */
export function startDailyReminders() {
  const tick = () =>
    runDailyRemindersIfDue().catch((error) =>
      console.error('Error en el recordatorio del día:', error.message)
    );
  tick();
  return setInterval(tick, 10 * 60 * 1000);
}
