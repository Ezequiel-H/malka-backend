import { describe, it, expect } from 'vitest';
import { parseArgentinaDayBounds, ARGENTINA_TZ } from '../../utils/argentinaTime.js';

describe('argentinaTime', () => {
  it('parses calendar day bounds in Buenos Aires', () => {
    const { fromStart, toEnd } = parseArgentinaDayBounds('2026-01-01', '2026-01-01');
    expect(fromStart.toISOString()).toBe('2026-01-01T03:00:00.000Z');
    expect(toEnd.toISOString()).toBe('2026-01-02T02:59:59.999Z');
  });

  it('exports IANA zone id', () => {
    expect(ARGENTINA_TZ).toBe('America/Argentina/Buenos_Aires');
  });
});
