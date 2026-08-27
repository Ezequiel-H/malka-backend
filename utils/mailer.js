/**
 * Transporte de emails.
 *
 * - Con RESEND_API_KEY: envía por la API HTTP de Resend (fetch nativo de
 *   Node 18+, sin dependencias).
 * - En tests: acumula en memoria (`__sentEmails`) para poder asertar.
 * - Sin key (dev): loguea el envío y no manda nada.
 *
 * `sendEmail` nunca lanza: una notificación caída no puede romper la
 * request que la disparó.
 */

const sent = [];

/** Sólo para tests: los "envíos" del transporte en memoria. */
export const __sentEmails = sent;

export async function sendEmail({ to, subject, html }) {
  if (!to || !subject) return false;

  if (process.env.NODE_ENV === 'test') {
    sent.push({ to, subject, html });
    return true;
  }

  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Malka <no-reply@casamalka.org>';

  if (!key) {
    console.log(`📭 [emails deshabilitados] "${subject}" → ${to}`);
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to, subject, html })
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
