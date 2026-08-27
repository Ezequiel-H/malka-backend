import { describe, it, expect, vi, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import {
  normalizeCalendarDateString,
  isValidCalendarDateString,
  isCalendarDateBeforeToday,
  assertValidBirthDate,
  todayCalendarDateInZone
} from '../../utils/calendarDate.js';
import { ARGENTINA_TZ } from '../../utils/argentinaTime.js';

describe('calendarDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes YYYY-MM-DD strings unchanged', () => {
    expect(normalizeCalendarDateString('1990-05-15')).toBe('1990-05-15');
  });

  it('normalizes legacy UTC Date values to calendar day in UTC', () => {
    const legacy = new Date(Date.UTC(1990, 4, 15, 12, 0, 0, 0));
    expect(normalizeCalendarDateString(legacy)).toBe('1990-05-15');
  });

  it('rejects invalid calendar days', () => {
    expect(isValidCalendarDateString('1990-02-30')).toBe(false);
    expect(isValidCalendarDateString('1990-05-15')).toBe(true);
  });

  it('compares birth dates against today in Argentina without timezone drift', () => {
    vi.useFakeTimers();
    vi.setSystemTime(DateTime.fromISO('2026-08-27T23:30:00', { zone: ARGENTINA_TZ }).toJSDate());

    expect(todayCalendarDateInZone()).toBe('2026-08-27');
    expect(isCalendarDateBeforeToday('2026-08-27')).toBe(false);
    expect(isCalendarDateBeforeToday('2026-08-26')).toBe(true);
    expect(assertValidBirthDate('1990-05-15')).toBe('1990-05-15');
  });
});
