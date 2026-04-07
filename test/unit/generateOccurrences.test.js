import { describe, it, expect } from 'vitest';
import {
  calculateOccurrences,
  calculateNextOccurrence
} from '../../utils/generateOccurrences.js';

const recurrentBase = {
  tipo: 'recurrente',
  hora: '10:00',
  recurrence: {
    frequency: 'daily',
    hora: '10:00'
  }
};

describe('calculateOccurrences', () => {
  it('throws if activity is not recurrente', () => {
    expect(() =>
      calculateOccurrences({ tipo: 'unica', recurrence: recurrentBase.recurrence }, 7)
    ).toThrow();
  });

  it('throws if recurrence missing', () => {
    expect(() => calculateOccurrences({ tipo: 'recurrente' }, 7)).toThrow();
  });

  it('generates daily occurrences within window', () => {
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
    const occ = calculateOccurrences(recurrentBase, 5, start);
    expect(occ.length).toBeGreaterThan(0);
    expect(occ[0]).toHaveProperty('fecha');
    expect(occ[0]).toHaveProperty('hora');
  });

  it('respects recurrence endDate', () => {
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(2026, 0, 3, 0, 0, 0, 0));
    const activity = {
      ...recurrentBase,
      recurrence: { ...recurrentBase.recurrence, endDate }
    };
    const occ = calculateOccurrences(activity, 30, start);
    expect(occ.length).toBeGreaterThan(0);
    occ.forEach((o) => {
      expect(o.fecha.getTime()).toBeLessThanOrEqual(endDate.getTime());
    });
  });

  it('supports weekly daysOfWeek', () => {
    const start = new Date(Date.UTC(2026, 0, 5, 0, 0, 0, 0)); // Monday
    const activity = {
      ...recurrentBase,
      recurrence: {
        frequency: 'weekly',
        daysOfWeek: [1],
        hora: '11:00'
      }
    };
    const occ = calculateOccurrences(activity, 14, start);
    expect(occ.length).toBeGreaterThan(0);
  });

  it('supports monthly dayOfMonth', () => {
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
    const activity = {
      ...recurrentBase,
      recurrence: {
        frequency: 'monthly',
        dayOfMonth: [15],
        hora: '12:00'
      }
    };
    const occ = calculateOccurrences(activity, 60, start);
    // monthly branch uses local date components in util implementation
    expect(occ.some((o) => o.fecha.getDate() === 15)).toBe(true);
  });
});

describe('calculateNextOccurrence', () => {
  it('returns null for non-recurrent activity', () => {
    expect(calculateNextOccurrence({ tipo: 'unica' })).toBeNull();
  });

  it('returns a Date for daily recurrence', () => {
    const activity = recurrentBase;
    const from = new Date(Date.UTC(2026, 2, 10, 0, 0, 0, 0));
    const next = calculateNextOccurrence(activity, from);
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});
