import User from '../models/User.model.js';
import Activity from '../models/Activity.model.js';
import { sendEmail } from './mailer.js';
import { sendPushToUser } from './push.js';

/**
 * Notificaciones a participantes: cada aviso sale por email Y por push (si
 * la persona activó las notificaciones en algún dispositivo).
 *
 * Cada `notify*` resuelve solo los datos que le falten (usuario/actividad
 * sin popular), arma el HTML con el layout de la marca y envía. Ninguna
 * lanza: se loguea y sigue, porque el aviso es un efecto secundario de la
 * operación, nunca su resultado. Devuelven si el email salió.
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

/** Email + push en paralelo; el resultado es el del email. */
const deliver = async (user, email, push) => {
  const [mailOk] = await Promise.all([sendEmail(email), sendPushToUser(user._id, push)]);
  return mailOk;
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
  return deliver(u, {
    to: u.email,
    subject: 'Tu cuenta en Malka fue aprobada',
    html: layout(
      `¡Hola${u.nombre ? `, ${u.nombre}` : ''}! Ya sos parte`,
      p('Tu cuenta fue aprobada por nuestro equipo.') +
        p('Ya podés ver la cartelera e inscribirte en las actividades.') +
        boton('Ver actividades', '/activities')
    )
  }, {
    title: 'Tu cuenta fue aprobada',
    body: 'Ya podés ver la cartelera e inscribirte en las actividades.',
    url: '/activities',
    tag: 'cuenta-aprobada'
  });
});

/** Inscripción confirmada (cupo asegurado). */
export const notifyInscriptionConfirmed = safe(async (inscription) => {
  const [u, act] = await Promise.all([
    resolveUser(inscription.userId),
    resolveActivity(inscription.activityId)
  ]);
  if (!u?.email || !act) return false;
  const cuando = fmtFecha(inscription.fecha, inscription.hora || act.hora);
  return deliver(u, {
    to: u.email,
    subject: `Inscripción confirmada: ${act.titulo}`,
    html: layout(
      'Tu lugar está confirmado',
      p(`Te esperamos en <strong>${act.titulo}</strong>.`) +
        p(cuando) +
        (act.lugar ? p(act.lugar) : '') +
        boton('Ver mis inscripciones', '/my-inscriptions')
    )
  }, {
    title: 'Tu lugar está confirmado',
    body: `${act.titulo} · ${cuando}`,
    url: '/my-inscriptions',
    tag: `inscripcion-${inscription._id}`
  });
});

/** Comprobante rechazado: tiene que subir uno nuevo. */
export const notifyPaymentRejected = safe(async (inscription, motivo) => {
  const [u, act] = await Promise.all([
    resolveUser(inscription.userId),
    resolveActivity(inscription.activityId)
  ]);
  if (!u?.email || !act) return false;
  return deliver(u, {
    to: u.email,
    subject: `Revisá tu comprobante: ${act.titulo}`,
    html: layout(
      'Tu comprobante fue rechazado',
      p(`No pudimos aprobar el comprobante de <strong>${act.titulo}</strong>.`) +
        (motivo ? p(`Motivo: ${motivo}`) : '') +
        p('Podés subir uno nuevo desde tus inscripciones y lo revisamos de nuevo.') +
        boton('Subir comprobante nuevo', '/my-inscriptions')
    )
  }, {
    title: 'Revisá tu comprobante',
    body: `No pudimos aprobar el comprobante de ${act.titulo}.${motivo ? ` Motivo: ${motivo}.` : ''}`,
    url: '/my-inscriptions',
    tag: `inscripcion-${inscription._id}`,
    actions: [{ action: 'subir', title: 'Subir otro', url: '/my-inscriptions' }]
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
  if (!email) return false;
  const act = await resolveActivity(inscription.activityId);
  return deliver({ _id: inscription.userId?._id || inscription.userId }, email, {
    title: `¡Se liberó un lugar en ${act.titulo}!`,
    body:
      inscription.estado === 'aceptada'
        ? 'Saliste de la lista de espera: tu lugar quedó confirmado.'
        : 'Saliste de la lista de espera: tu inscripción quedó pendiente.',
    url: '/my-inscriptions',
    tag: `inscripcion-${inscription._id}`
  });
});

/** Mail de prueba (lo usa `npm run email:test`): el mismo layout que los avisos reales. */
export const buildTestEmail = (to) => ({
  to,
  subject: 'Prueba de notificaciones de Malka',
  html: layout(
    'Los avisos por mail funcionan',
    p('Este es un mail de prueba del sistema de Malka.') +
      p('Si te llegó a la bandeja de entrada (y no a spam), el envío está bien configurado.') +
      boton('Abrir Malka', '/dashboard')
  )
});
