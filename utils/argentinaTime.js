import { DateTime } from 'luxon';

/** Zona horaria unificada para rangos de fechas y agregaciones semanales en el panel admin. */
export const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

/**
 * Interpreta from/to como días calendario en Argentina (inicio y fin de día local).
 * @param {string} fromStr - YYYY-MM-DD
 * @param {string} toStr - YYYY-MM-DD
 */
export function parseArgentinaDayBounds(fromStr, toStr) {
  const fromStart = DateTime.fromISO(`${fromStr}T00:00:00`, { zone: ARGENTINA_TZ }).toJSDate();
  const toEnd = DateTime.fromISO(`${toStr}T23:59:59.999`, { zone: ARGENTINA_TZ }).toJSDate();
  return { fromStart, toEnd };
}
