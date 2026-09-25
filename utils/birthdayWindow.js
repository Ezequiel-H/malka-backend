import { DateTime } from 'luxon';
import { ARGENTINA_TZ } from './argentinaTime.js';

/**
 * La ventana de cumpleaños del panel: de hoy al domingo de la semana que viene.
 *
 * "Esta semana y la siguiente" se corta por semana calendario (lunes a domingo,
 * como el resto del panel), no por 14 días rodantes: el admin piensa en semanas,
 * y así el jueves ve hasta el domingo próximo y no hasta un jueves cualquiera.
 *
 * Lo de atrás no se muestra. Un cumpleaños que ya pasó no es una tarea
 * pendiente, es un reproche.
 */
export function birthdayWindow(hoyISO, timeZone = ARGENTINA_TZ) {
  const hoy = hoyISO
    ? DateTime.fromISO(hoyISO, { zone: timeZone })
    : DateTime.now().setZone(timeZone);
  const desde = hoy.startOf('day');

  // Luxon: weekday 1 = lunes, 7 = domingo.
  const finDeEstaSemana = desde.plus({ days: 7 - desde.weekday });
  const hasta = finDeEstaSemana.plus({ days: 7 });

  return { desde, hasta, finDeEstaSemana };
}

/**
 * Los días de la ventana como 'MM-DD', que es con lo que se compara una fecha
 * de nacimiento: del año de nacimiento no nos importa nada más que la edad.
 *
 * El 29 de febrero se pliega al 28 en los años que no son bisiestos. Si no,
 * quien nació ese día desaparecería del panel tres años de cada cuatro.
 */
export function monthDaysInWindow(hoyISO, timeZone = ARGENTINA_TZ) {
  const { desde, hasta } = birthdayWindow(hoyISO, timeZone);
  const dias = [];

  for (let cursor = desde; cursor <= hasta; cursor = cursor.plus({ days: 1 })) {
    dias.push(cursor.toFormat('MM-dd'));
    const esVeintiochoDeFebreroNoBisiesto = cursor.month === 2 && cursor.day === 28 && !cursor.isInLeapYear;
    if (esVeintiochoDeFebreroNoBisiesto) dias.push('02-29');
  }

  return dias;
}

/**
 * Convierte una fecha de nacimiento (YYYY-MM-DD) en la fila que dibuja el panel.
 * Devuelve null si ese cumpleaños no cae en la ventana.
 */
export function describeBirthday(fechaNacimiento, hoyISO, timeZone = ARGENTINA_TZ) {
  const partes = String(fechaNacimiento ?? '').split('-');
  if (partes.length !== 3) return null;
  const [anioNacimiento, mes, dia] = partes.map(Number);
  if (!anioNacimiento || !mes || !dia) return null;

  const { desde, hasta, finDeEstaSemana } = birthdayWindow(hoyISO, timeZone);

  // Se prueban los dos años que la ventana puede tocar: la semana que viene
  // puede caer en enero mientras hoy es diciembre.
  const candidatos = [desde.year, desde.year + 1].map((anio) => {
    const plegado = mes === 2 && dia === 29 && !DateTime.fromObject({ year: anio }, { zone: timeZone }).isInLeapYear;
    return {
      fecha: DateTime.fromObject(
        { year: anio, month: mes, day: plegado ? 28 : dia },
        { zone: timeZone }
      ),
      plegado
    };
  });

  const match = candidatos.find(({ fecha }) => fecha >= desde && fecha <= hasta);
  if (!match) return null;

  return {
    fecha: match.fecha.toFormat('yyyy-MM-dd'),
    // Los años que cumple, no los que tiene: es el número que va en el saludo.
    edad: match.fecha.year - anioNacimiento,
    esHoy: match.fecha.hasSame(desde, 'day'),
    diasFaltan: Math.round(match.fecha.diff(desde, 'days').days),
    semana: match.fecha <= finDeEstaSemana ? 'esta' : 'proxima',
    // Para avisar en pantalla que a esta persona le corrimos el festejo.
    veintinueveDeFebrero: match.plegado
  };
}
