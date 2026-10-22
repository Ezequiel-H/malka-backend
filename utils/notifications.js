import User from '../models/User.model.js';
import Activity from '../models/Activity.model.js';
import { sendEmail } from './mailer.js';

/**
 * Notificaciones por email a participantes.
 *
 * Cada `notify*` resuelve solo los datos que le falten (usuario/actividad
 * sin popular), arma el HTML con el layout de la marca y envía. Ninguna
 * lanza: se loguea y sigue, porque el email es un efecto secundario de la
 * operación, nunca su resultado.
 */

const APP_URL = () => process.env.FRONTEND_URL || 'http://localhost:5174';

const VERDE = '#689b78';
const CREMA = '#f9f2e8';
const TINTA = '#2f3a33';

const layout = (titulo, cuerpo) => `
  <div style="margin:0;padding:32px 16px;background:${CREMA};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TINTA};">
    <div style="max-width:520px;margin:0 auto;">
      <p style="text-align:center;margin:0 0 24px;font-size:28px;letter-spacing:6px;color:${VERDE};font-weight:600;">MALKA</p>
      <div style="background:#ffffff;border-radius:16px;padding:28px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <h1 style="margin:0 0 16px;font-size:20px;color:${TINTA};">${titulo}</h1>
        ${cuerpo}
      </div>
      <p style="text-align:center;margin:24px 0 0;font-size:12px;color:#8a9088;">
        Casa Malka · El punto de encuentro para tu identidad judía
      </p>
    </div>
  </div>`;

const boton = (texto, path) => `
  <p style="margin:24px 0 4px;">
    <a href="${APP_URL()}${path}"
       style="display:inline-block;background:${VERDE};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">
      ${texto}
    </a>
  </p>`;

const p = (texto) => `<p style="margin:0 0 12px;line-height:1.55;color:${TINTA};">${texto}</p>`;

const fmtFecha = (fecha, hora) => {
  if (!fecha) return '';
  const f = new Date(fecha).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  });
  return hora ? `${f} · ${hora}` : f;
};

const resolveUser = async (userRef) => {
  if (userRef && userRef.email) return userRef;
  const id = userRef && userRef._id ? userRef._id : userRef;
  return id ? User.findById(id).select('email nombre') : null;
};

const resolveActivity = async (activityRef) => {
  if (activityRef && activityRef.titulo) return activityRef;
  const id = activityRef && activityRef._id ? activityRef._id : activityRef;
  return id ? Activity.findById(id).select('titulo hora tipo esGratuita lugar') : null;
};

const safe = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (error) {
    console.error('Error enviando notificación:', error.message);
    return false;
  }
};

/** Cuenta aprobada por el equipo: ya puede inscribirse. */
export const notifyUserApproved = safe(async (user) => {
  const u = await resolveUser(user);
  if (!u?.email) return false;
  return sendEmail({
    to: u.email,
    subject: 'Tu cuenta en Malka fue aprobada',
    html: layout(
      `¡Hola${u.nombre ? `, ${u.nombre}` : ''}! Ya sos parte`,
      p('Tu cuenta fue aprobada por nuestro equipo.') +
        p('Ya podés ver la cartelera e inscribirte en las actividades.') +
        boton('Ver actividades', '/activities')
    )
  });
});

/** Inscripción confirmada (cupo asegurado). */
export const notifyInscriptionConfirmed = safe(async (inscription) => {
  const [u, act] = await Promise.all([
    resolveUser(inscription.userId),
    resolveActivity(inscription.activityId)
  ]);
  if (!u?.email || !act) return false;
  return sendEmail({
    to: u.email,
    subject: `Inscripción confirmada: ${act.titulo}`,
    html: layout(
      'Tu lugar está confirmado',
      p(`Te esperamos en <strong>${act.titulo}</strong>.`) +
        p(fmtFecha(inscription.fecha, inscription.hora || act.hora)) +
        (act.lugar ? p(act.lugar) : '') +
        boton('Ver mis inscripciones', '/my-inscriptions')
    )
  });
});

/** Comprobante rechazado: tiene que subir uno nuevo. */
export const notifyPaymentRejected = safe(async (inscription, motivo) => {
  const [u, act] = await Promise.all([
    resolveUser(inscription.userId),
    resolveActivity(inscription.activityId)
  ]);
  if (!u?.email || !act) return false;
  return sendEmail({
    to: u.email,
    subject: `Revisá tu comprobante: ${act.titulo}`,
    html: layout(
      'Tu comprobante fue rechazado',
      p(`No pudimos aprobar el comprobante de <strong>${act.titulo}</strong>.`) +
        (motivo ? p(`Motivo: ${motivo}`) : '') +
        p('Podés subir uno nuevo desde tus inscripciones y lo revisamos de nuevo.') +
        boton('Subir comprobante nuevo', '/my-inscriptions')
    )
  });
});

/**
 * Mail de «se liberó un lugar» (sin enviar), para que el admin lo vea antes
 * de mandarlo. Devuelve `null` si falta el usuario o la actividad.
 */
export const buildWaitlistPromotedEmail = async (inscription) => {
  const [u, act] = await Promise.all([
    resolveUser(inscription.userId),
    resolveActivity(inscription.activityId)
  ]);
  if (!u?.email || !act) return null;

  const confirmada = inscription.estado === 'aceptada';
  const esViajePago = act.tipo === 'viaje' && act.esGratuita === false;

  let detalle;
  if (confirmada) {
    detalle = p('Tu lugar quedó <strong>confirmado</strong>. ¡Te esperamos!');
  } else if (esViajePago) {
    detalle = p('Nos vamos a contactar por WhatsApp para coordinar el pago y confirmar tu cupo.');
  } else if (act.esGratuita === false) {
    detalle = p('Tu inscripción quedó <strong>pendiente</strong>: en cuanto revisemos tu pago te confirmamos el lugar.');
  } else {
    detalle = p('Tu inscripción quedó <strong>pendiente</strong>: en cuanto la revisemos te confirmamos el lugar.');
  }

  return {
    to: u.email,
    subject: `¡Se liberó un lugar en ${act.titulo}!`,
    html: layout(
      'Saliste de la lista de espera',
      p(`Se liberó un lugar en <strong>${act.titulo}</strong> (${fmtFecha(inscription.fecha, inscription.hora || act.hora)}).`) +
        detalle +
        boton('Ver mis inscripciones', '/my-inscriptions')
    )
  };
};

/** Salió de la lista de espera: sólo cuando el admin lo mueve y elige avisar. */
export const notifyWaitlistPromoted = safe(async (inscription) => {
  const email = await buildWaitlistPromotedEmail(inscription);
  return email ? sendEmail(email) : false;
});
