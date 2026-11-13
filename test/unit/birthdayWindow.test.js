import { describe, it, expect } from 'vitest';
import { birthdayWindow, monthDaysInWindow, describeBirthday } from '../../utils/birthdayWindow.js';

// 2026-09-25 es viernes. Domingo de esta semana: 27/09. De la siguiente: 04/10.
const VIERNES = '2026-09-25';

describe('birthdayWindow', () => {
  it('va de hoy al domingo de la semana que viene', () => {
    const { desde, hasta, finDeEstaSemana } = birthdayWindow(VIERNES);
    expect(desde.toFormat('yyyy-MM-dd')).toBe('2026-09-25');
    expect(finDeEstaSemana.toFormat('yyyy-MM-dd')).toBe('2026-09-27');
    expect(hasta.toFormat('yyyy-MM-dd')).toBe('2026-10-04');
  });

  it('un lunes abarca las dos semanas completas', () => {
    const { desde, hasta } = birthdayWindow('2026-09-21');
    expect(desde.toFormat('yyyy-MM-dd')).toBe('2026-09-21');
    expect(hasta.toFormat('yyyy-MM-dd')).toBe('2026-10-04');
  });

  it('un domingo, esta semana es sólo hoy', () => {
    const { desde, hasta, finDeEstaSemana } = birthdayWindow('2026-09-27');
    expect(finDeEstaSemana.toFormat('yyyy-MM-dd')).toBe('2026-09-27');
    expect(hasta.toFormat('yyyy-MM-dd')).toBe('2026-10-04');
    expect(desde.toFormat('yyyy-MM-dd')).toBe('2026-09-27');
  });
});

describe('monthDaysInWindow', () => {
  it('lista los días de la ventana como MM-DD', () => {
    const dias = monthDaysInWindow(VIERNES);
    expect(dias[0]).toBe('09-25');
    expect(dias).toContain('10-01');
    expect(dias.at(-1)).toBe('10-04');
  });

  it('cruza el fin de año sin repetir días', () => {
    const dias = monthDaysInWindow('2026-12-28');
    expect(dias).toContain('12-31');
    expect(dias).toContain('01-01');
    expect(new Set(dias).size).toBe(dias.length);
  });

  it('suma el 29 de febrero cuando el año no es bisiesto', () => {
    expect(monthDaysInWindow('2027-02-24')).toContain('02-29');
    // 2028 sí es bisiesto: el 29 entra por derecho propio, no plegado.
    const bisiesto = monthDaysInWindow('2028-02-24');
    expect(bisiesto.filter((d) => d === '02-29')).toHaveLength(1);
  });
});

describe('describeBirthday', () => {
  it('marca el cumpleaños de hoy y calcula la edad que cumple', () => {
    const r = describeBirthday('1992-09-25', VIERNES);
    expect(r).toMatchObject({ fecha: '2026-09-25', edad: 34, esHoy: true, diasFaltan: 0, semana: 'esta' });
  });

  it('separa esta semana de la siguiente', () => {
    expect(describeBirthday('1990-09-27', VIERNES)).toMatchObject({ semana: 'esta', diasFaltan: 2 });
    expect(describeBirthday('1990-09-28', VIERNES)).toMatchObject({ semana: 'proxima', diasFaltan: 3 });
    expect(describeBirthday('1990-10-04', VIERNES)).toMatchObject({ semana: 'proxima', diasFaltan: 9 });
  });

  it('deja afuera lo que ya pasó y lo que está más lejos', () => {
    expect(describeBirthday('1990-09-24', VIERNES)).toBeNull();
    expect(describeBirthday('1990-10-05', VIERNES)).toBeNull();
  });

  it('resuelve el año correcto cuando la ventana cruza enero', () => {
    // El 28/12/2026 es lunes: esta semana termina el domingo 03/01/2027.
    expect(describeBirthday('1995-01-02', '2026-12-28')).toMatchObject({
      fecha: '2027-01-02',
      edad: 32,
      semana: 'esta'
    });
    expect(describeBirthday('1995-01-07', '2026-12-28')).toMatchObject({
      fecha: '2027-01-07',
      semana: 'proxima'
    });
  });

  it('festeja el 29 de febrero el 28 en años no bisiestos', () => {
    const r = describeBirthday('2000-02-29', '2027-02-24');
    expect(r).toMatchObject({ fecha: '2027-02-28', edad: 27, veintinueveDeFebrero: true });
  });

  it('ignora fechas mal formadas', () => {
    expect(describeBirthday('', VIERNES)).toBeNull();
    expect(describeBirthday(null, VIERNES)).toBeNull();
    expect(describeBirthday('1990-09', VIERNES)).toBeNull();
  });
});
