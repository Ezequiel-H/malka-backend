import nodemailer from 'nodemailer';

/**
 * Transporte de emails.
 *
 * El proveedor se elige por variables de entorno, sin tocar código:
 * - SMTP_HOST (+ SMTP_PORT, SMTP_USER, SMTP_PASS): SMTP con nodemailer. Es el
 *   camino para Google Workspace (smtp-relay.gmail.com) y sirve igual para
 *   cualquier proveedor que hable SMTP (Brevo, Mailjet, Resend…).
 * - RESEND_API_KEY: la API HTTP de Resend. Queda como alternativa para
 *   hostings que bloquean los puertos SMTP salientes.
 * - En tests: acumula en memoria (`__sentEmails`) para poder asertar.
 * - Sin ninguno (dev): loguea el envío y no manda nada.
 *
 * `sendEmail` nunca lanza: una notificación caída no puede romper la
 * request que la disparó. Devuelve true cuando el servidor ACEPTÓ el mail,
 * que no es lo mismo que entregado: la entrega (o el rebote) pasa después,
 * del lado del proveedor.
 */

const sent = [];

/** Sólo para tests: los "envíos" del transporte en memoria. */
export const __sentEmails = sent;

const DEFAULT_FROM = 'Malka <notificaciones@casamalka.org>';

/* Reintentos sólo para fallas transitorias (conexión, 4xx de SMTP). Un 5xx
   (credenciales, remitente no autorizado) no se arregla reintentando. */
const RETRIES = 2;
const retryDelayMs = () => Number(process.env.SMTP_RETRY_DELAY_MS ?? 2000);

/** Para los logs: el dominio sí, la casilla no. */
const maskEmail = (to) =>
  String(to).replace(/^([^@]{0,2})[^@]*@/, (_, keep) => `${keep}***@`);

/** Texto plano a partir del HTML, para los clientes que no muestran HTML. */
export const htmlToText = (html) =>
  String(html)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2: $1')
    .replace(/<\/(p|h1)>/gi, '\n\n')
    .replace(/<(br|\/div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

let smtpTransport = null;
const getSmtpTransport = () => {
  if (!smtpTransport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      // En 587 el TLS es obligatorio (STARTTLS): nunca credenciales en claro.
      requireTLS: port !== 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
      // smtp-relay.gmail.com pide un nombre en el EHLO: sin él rechaza con 421.
      name: process.env.SMTP_EHLO_NAME || 'casamalka.org',
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000
    });
  }
  return smtpTransport;
};

const isTransient = (error) => {
  if (error.responseCode) return error.responseCode >= 400 && error.responseCode < 500;
  return ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EDNS'].includes(error.code);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendViaSmtp(message) {
  for (let attempt = 0; ; attempt++) {
    try {
      const info = await getSmtpTransport().sendMail(message);
      console.log(`📨 Email aceptado por SMTP: "${message.subject}" → ${maskEmail(message.to)} (${info.messageId})`);
      return true;
    } catch (error) {
      if (attempt < RETRIES && isTransient(error)) {
        await wait(retryDelayMs() * (attempt + 1));
        continue;
      }
      // Sólo código y respuesta del servidor: nunca el objeto entero, que
      // puede traer la config del transporte.
      console.error(
        `Error enviando email por SMTP (${error.code || 'sin código'} ${error.responseCode || ''}):`,
        error.response || error.message
      );
      return false;
    }
  }
}

async function sendViaResend(message) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: message.replyTo
      })
    });
    if (!res.ok) {
      console.error('Error enviando email:', res.status, await res.text());
    }
    return res.ok;
  } catch (error) {
    console.error('Error enviando email:', error.message);
    return false;
  }
}

export async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!to || !subject) return false;

  const message = {
    from: process.env.EMAIL_FROM || DEFAULT_FROM,
    to,
    subject,
    html,
    text: text || (html ? htmlToText(html) : undefined),
    replyTo: replyTo || process.env.EMAIL_REPLY_TO || undefined
  };

  if (process.env.NODE_ENV === 'test') {
    sent.push(message);
    return true;
  }

  if (process.env.SMTP_HOST) return sendViaSmtp(message);
  if (process.env.RESEND_API_KEY) return sendViaResend(message);

  console.log(`📭 [emails deshabilitados] "${subject}" → ${maskEmail(to)}`);
  return false;
}

/** Prueba la conexión y el login SMTP sin mandar nada (lo usa el script de prueba). */
export async function verifySmtp() {
  if (!process.env.SMTP_HOST) throw new Error('SMTP_HOST no está configurado');
  return getSmtpTransport().verify();
}
