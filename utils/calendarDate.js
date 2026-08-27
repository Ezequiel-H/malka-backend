import { DateTime } from 'luxon';
import { ARGENTINA_TZ } from './argentinaTime.js';

export const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Normaliza a YYYY-MM-DD o null si el formato no es válido. */
export function normalizeCalendarDateString(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return CALENDAR_DATE_REGEX.test(trimmed) ? trimmed : null;
}

/** Verifica que la fecha calendario exista (p. ej. no 1990-02-30). */
export function isValidCalendarDateString(value) {
  const normalized = normalizeCalendarDateString(value);
  if (!normalized) return false;
  const [year, month, day] = normalized.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Hoy como YYYY-MM-DD en la zona indicada (por defecto Argentina). */
export function todayCalendarDateInZone(timeZone = ARGENTINA_TZ) {
  return DateTime.now().setZone(timeZone).toFormat('yyyy-MM-dd');
}

/** true si dateStr es un día calendario anterior a hoy en la zona indicada. */
export function isCalendarDateBeforeToday(dateStr, timeZone = ARGENTINA_TZ) {
  const normalized = normalizeCalendarDateString(dateStr);
  if (!normalized) return false;
  return normalized < todayCalendarDateInZone(timeZone);
}

export function assertValidBirthDate(value) {
  const normalized = normalizeCalendarDateString(value);
  if (!normalized) {
    throw new Error('La fecha de nacimiento debe tener formato YYYY-MM-DD');
  }
  if (!isValidCalendarDateString(normalized)) {
    throw new Error('Fecha de nacimiento inválida');
  }
  if (!isCalendarDateBeforeToday(normalized)) {
    throw new Error('La fecha de nacimiento debe ser anterior a hoy');
  }
  return normalized;
}
