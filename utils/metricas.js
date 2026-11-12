import { DateTime } from 'luxon';
import { ARGENTINA_TZ } from './argentinaTime.js';

/**
 * Las métricas de personas y de plata para el tablero del equipo.
 *
 * Todo sale de una sola cuenta pura (sin base de datos) para poder testearla
 * con datos armados a mano. El controlador sólo busca los documentos.
 *
 * Una **participación** es una inscripción aceptada a un encuentro que ya
 * pasó, salvo que el equipo haya marcado que la persona faltó. Mientras no se
 * tome asistencia, estar aceptado cuenta como haber venido: es el mejor dato
 * que hay, y la sección de asistencia dice cuánto de eso está confirmado.
 */

const DIA_MS = 86400000;
export const VENTANA_RETORNO_DIAS = 60;
export const UMBRAL_FRECUENTE = 5;

export const TRAMOS_FRECUENCIA = [
  { id: '1', etiqueta: '1 vez', min: 1, max: 1 },
  { id: '2-4', etiqueta: '2 a 4', min: 2, max: 4 },
  { id: '5-9', etiqueta: '5 a 9', min: 5, max: 9 },
  { id: '10-24', etiqueta: '10 a 24', min: 10, max: 24 },
  { id: '25+', etiqueta: '25 o más', min: 25, max: Infinity },
];

export const TRAMOS_EDAD = [
  { id: '<18', etiqueta: 'Menos de 18', min: 0, max: 17 },
  { id: '18-21', etiqueta: '18 a 21', min: 18, max: 21 },
  { id: '22-25', etiqueta: '22 a 25', min: 22, max: 25 },
  { id: '26-29', etiqueta: '26 a 29', min: 26, max: 29 },
  { id: '30-35', etiqueta: '30 a 35', min: 30, max: 35 },
  { id: '36+', etiqueta: '36 o más', min: 36, max: Infinity },
];

/* Las fechas de los encuentros y de los gastos son días de calendario
   guardados en UTC: se leen con las partes UTC, no con la hora local. */
const diaCalendario = (fecha) => new Date(fecha).toISOString().slice(0, 10);
const mesCalendario = (fecha) => new Date(fecha).toISOString().slice(0, 7);
/* Las altas (createdAt) son instantes: el mes es el de Buenos Aires. */
const mesArgentina = (fecha) => DateTime.fromJSDate(new Date(fecha)).setZone(ARGENTINA_TZ).toFormat('yyyy-MM');

/** Límites de un rango de días de calendario (YYYY-MM-DD), inclusive. */
export const limitesDias = (desde, hasta) => ({
  inicio: new Date(`${desde}T00:00:00.000Z`),
  fin: new Date(`${hasta}T23:59:59.999Z`),
});

/** Los meses (YYYY-MM) entre dos fechas, inclusive, para que no falten los vacíos. */
export const mesesEntre = (inicio, fin) => {
  const meses = [];
  let cursor = DateTime.fromJSDate(inicio, { zone: 'utc' }).startOf('month');
  const ultimo = DateTime.fromJSDate(fin, { zone: 'utc' }).startOf('month');
  while (cursor <= ultimo) {
    meses.push(cursor.toFormat('yyyy-MM'));
    cursor = cursor.plus({ months: 1 });
  }
  return meses;
};

const edadA = (nacimiento, hoy) => {
  if (!nacimiento) return null;
  const n = new Date(nacimiento);
  if (Number.isNaN(n.getTime())) return null;
  let edad = hoy.getUTCFullYear() - n.getUTCFullYear();
  const antesDelCumple =
    hoy.getUTCMonth() < n.getUTCMonth() ||
    (hoy.getUTCMonth() === n.getUTCMonth() && hoy.getUTCDate() < n.getUTCDate());
  if (antesDelCumple) edad -= 1;
  return edad >= 0 && edad < 120 ? edad : null;
};

const contarPor = (items, clave) => {
  const mapa = new Map();
  for (const item of items) {
    const k = clave(item);
    mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  return mapa;
};

const sumarPor = (items, clave, valor) => {
  const mapa = new Map();
  for (const item of items) {
    const k = clave(item);
    mapa.set(k, (mapa.get(k) ?? 0) + valor(item));
  }
  return mapa;
};

const porcentaje = (parte, total) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : null);
const redondear = (n) => Math.round(n * 100) / 100;
const mediana = (valores) => {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
};

/** Lo que se cobró por una inscripción pagada y aprobada. */
const montoPago = (i) => i.pago?.montoEsperado ?? i.actividad?.precio ?? 0;
const monedaDe = (i) => i.actividad?.moneda ?? 'ARS';

/**
 * @param {object} p
 * @param {Array} p.usuarios       participantes: { _id, createdAt, fechaNacimiento }
 * @param {Array} p.inscripciones  aceptadas, de toda la historia: { userId, activityId, fecha,
 *                                 asistencia, pago, actividad: { titulo, categorias, precio, moneda, esGratuita } }
 * @param {Array} p.gastos         del rango: { fecha, monto, moneda, categoria, concepto, actividadId, actividadTitulo }
 * @param {Array} p.categorias     tags: { nombre, color }
 * @param {string} p.desde         YYYY-MM-DD
 * @param {string} p.hasta         YYYY-MM-DD
 * @param {Date}   p.hoy
 */
export function calcularMetricas({ usuarios, inscripciones, gastos, categorias = [], desde, hasta, hoy = new Date() }) {
  const { inicio, fin } = limitesDias(desde, hasta);
  const finEfectivo = fin < hoy ? fin : hoy;
  const enRango = (fecha) => {
    const t = new Date(fecha).getTime();
    return t >= inicio.getTime() && t <= finEfectivo.getTime();
  };
  const meses = mesesEntre(inicio, fin);
  const id = (v) => String(v);

  /* ---- Participaciones ---- */
  const pasadas = inscripciones.filter((i) => new Date(i.fecha) <= hoy);
  const participaciones = pasadas
    .filter((i) => i.asistencia !== 'falto')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  const historialPorPersona = new Map();
  for (const p of participaciones) {
    const u = id(p.userId);
    if (!historialPorPersona.has(u)) historialPorPersona.set(u, []);
    historialPorPersona.get(u).push(p);
  }
  const primeraVez = new Map([...historialPorPersona].map(([u, lista]) => [u, new Date(lista[0].fecha)]));

  const delRango = participaciones.filter((p) => enRango(p.fecha));
  const porPersonaEnRango = contarPor(delRango, (p) => id(p.userId));
  const participantes = new Set(porPersonaEnRango.keys());
  const nuevos = [...participantes].filter((u) => enRango(primeraVez.get(u)));

  /* Vuelven: de quienes vinieron por primera vez en el rango, y hace al menos
     60 días (si no, todavía no tuvieron tiempo de volver), cuántos volvieron a
     otro encuentro dentro de esos 60 días. */
  const cohorte = nuevos.filter((u) => hoy - primeraVez.get(u) >= VENTANA_RETORNO_DIAS * DIA_MS);
  const volvieron = cohorte.filter((u) => {
    const primera = primeraVez.get(u).getTime();
    const limite = primera + VENTANA_RETORNO_DIAS * DIA_MS;
    return historialPorPersona.get(u).some((p) => {
      const t = new Date(p.fecha).getTime();
      return t > primera && t <= limite;
    });
  });

  const activos = Object.fromEntries(
    [30, 60, 90].map((dias) => {
      const desdeT = hoy.getTime() - dias * DIA_MS;
      const set = new Set(
        participaciones.filter((p) => new Date(p.fecha).getTime() >= desdeT).map((p) => id(p.userId))
      );
      return [`d${dias}`, set.size];
    })
  );

  const frecuencia = TRAMOS_FRECUENCIA.map((tramo) => ({
    id: tramo.id,
    etiqueta: tramo.etiqueta,
    personas: [...porPersonaEnRango.values()].filter((n) => n >= tramo.min && n <= tramo.max).length,
  }));
  const frecuentes = [...porPersonaEnRango.values()].filter((n) => n >= UMBRAL_FRECUENTE).length;

  /* ---- Registros ---- */
  const registrosEnRango = usuarios.filter((u) => {
    const t = new Date(u.createdAt).getTime();
    return t >= inicio.getTime() && t <= fin.getTime();
  });
  const registrosPorMes = contarPor(registrosEnRango, (u) => mesArgentina(u.createdAt));

  /* ---- Por mes ---- */
  const delRangoPorMes = new Map(meses.map((m) => [m, []]));
  for (const p of delRango) delRangoPorMes.get(mesCalendario(p.fecha))?.push(p);
  const porMes = meses.map((mes) => {
    const lista = delRangoPorMes.get(mes);
    const personas = new Set(lista.map((p) => id(p.userId)));
    const nuevasDelMes = [...personas].filter((u) => mesCalendario(primeraVez.get(u)) === mes);
    return {
      mes,
      participaciones: lista.length,
      personas: personas.size,
      nuevas: nuevasDelMes.length,
      registros: registrosPorMes.get(mes) ?? 0,
    };
  });

  /* ---- Temporadas: día de la semana × mes ---- */
  const temporadas = [];
  for (const mes of meses) {
    const lista = delRangoPorMes.get(mes);
    const porDia = contarPor(lista, (p) => (new Date(p.fecha).getUTCDay() + 6) % 7); // 0 = lunes
    for (let dia = 0; dia < 7; dia += 1) temporadas.push({ mes, dia, participaciones: porDia.get(dia) ?? 0 });
  }

  /* ---- Cruce entre propuestas ---- */
  const categoriasPorPersona = new Map();
  for (const p of delRango) {
    const u = id(p.userId);
    if (!categoriasPorPersona.has(u)) categoriasPorPersona.set(u, new Set());
    for (const c of p.actividad?.categorias ?? []) categoriasPorPersona.get(u).add(c);
  }
  const personasPorCategoria = new Map();
  for (const set of categoriasPorPersona.values()) {
    for (const c of set) personasPorCategoria.set(c, (personasPorCategoria.get(c) ?? 0) + 1);
  }
  const principales = [...personasPorCategoria.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([nombre]) => nombre);
  const colorDe = new Map(categorias.map((c) => [c.nombre, c.color]));
  const matriz = principales.map((a) =>
    principales.map((b) => [...categoriasPorPersona.values()].filter((set) => set.has(a) && set.has(b)).length)
  );

  /* ---- Edad ---- */
  const usuarioPorId = new Map(usuarios.map((u) => [id(u._id), u]));
  const edades = [...participantes].map((u) => edadA(usuarioPorId.get(u)?.fechaNacimiento, hoy)).filter((e) => e !== null);
  const edad = {
    promedio: edades.length ? Math.round((edades.reduce((a, b) => a + b, 0) / edades.length) * 10) / 10 : null,
    conDato: edades.length,
    sinDato: participantes.size - edades.length,
    tramos: TRAMOS_EDAD.map((t) => ({
      id: t.id,
      etiqueta: t.etiqueta,
      personas: edades.filter((e) => e >= t.min && e <= t.max).length,
    })),
  };

  /* ---- Asistencia: inscriptos vs. los que vinieron ---- */
  const aceptadasDelRango = pasadas.filter((i) => enRango(i.fecha));
  const vinieron = aceptadasDelRango.filter((i) => i.asistencia === 'vino').length;
  const faltaron = aceptadasDelRango.filter((i) => i.asistencia === 'falto').length;
  const asistencia = {
    inscriptos: aceptadasDelRango.length,
    vinieron,
    faltaron,
    sinMarcar: aceptadasDelRango.length - vinieron - faltaron,
    tasa: porcentaje(vinieron, vinieron + faltaron),
  };

  /* ---- Plata ---- */
  const pagos = aceptadasDelRango.filter((i) => i.pago?.estadoPago === 'aprobado');
  const pagosArs = pagos.filter((i) => monedaDe(i) === 'ARS');
  const recaudado = pagosArs.reduce((total, i) => total + montoPago(i), 0);
  const recaudadoUsd = pagos.filter((i) => monedaDe(i) === 'USD').reduce((total, i) => total + montoPago(i), 0);
  const pagadoPorPersona = sumarPor(pagosArs, (i) => id(i.userId), montoPago);

  const porActividadMapa = new Map();
  for (const i of pagosArs) {
    const k = id(i.activityId);
    const fila = porActividadMapa.get(k) ?? { actividadId: k, titulo: i.actividad?.titulo ?? 'Sin título', recaudado: 0, pagos: 0 };
    fila.recaudado += montoPago(i);
    fila.pagos += 1;
    porActividadMapa.set(k, fila);
  }
  const porActividad = [...porActividadMapa.values()].sort((a, b) => b.recaudado - a.recaudado).slice(0, 8);

  const gastosArs = gastos.filter((g) => (g.moneda ?? 'ARS') === 'ARS');
  const gastado = gastosArs.reduce((total, g) => total + g.monto, 0);
  const gastosPorCategoria = [...sumarPor(gastosArs, (g) => g.categoria ?? 'otros', (g) => g.monto).entries()]
    .map(([categoria, total]) => ({ categoria, total }))
    .sort((a, b) => b.total - a.total);
  const recaudadoPorMes = sumarPor(pagosArs, (i) => mesCalendario(i.fecha), montoPago);
  const gastadoPorMes = sumarPor(gastosArs, (g) => mesCalendario(g.fecha), (g) => g.monto);

  /* Costo por encuentro: los gastos atados a una actividad, agrupados por el
     día del encuentro, contra lo que se recaudó ese mismo día. */
  const encuentros = new Map();
  for (const g of gastosArs.filter((x) => x.actividadId)) {
    const k = `${id(g.actividadId)}|${diaCalendario(g.fecha)}`;
    const e = encuentros.get(k) ?? { actividadId: id(g.actividadId), titulo: g.actividadTitulo ?? 'Sin título', costo: 0, recaudado: 0, personas: 0 };
    e.costo += g.monto;
    encuentros.set(k, e);
  }
  for (const i of pagosArs) {
    const e = encuentros.get(`${id(i.activityId)}|${diaCalendario(i.fecha)}`);
    if (e) e.recaudado += montoPago(i);
  }
  for (const p of delRango) {
    const e = encuentros.get(`${id(p.activityId)}|${diaCalendario(p.fecha)}`);
    if (e) e.personas += 1;
  }
  const costoPorActividad = new Map();
  for (const e of encuentros.values()) {
    const fila = costoPorActividad.get(e.actividadId) ?? { actividadId: e.actividadId, titulo: e.titulo, encuentros: 0, costo: 0, recaudado: 0, personas: 0 };
    fila.encuentros += 1;
    fila.costo += e.costo;
    fila.recaudado += e.recaudado;
    fila.personas += e.personas;
    costoPorActividad.set(e.actividadId, fila);
  }
  const costoPorEncuentro = [...costoPorActividad.values()]
    .map((f) => ({
      actividadId: f.actividadId,
      titulo: f.titulo,
      encuentros: f.encuentros,
      costoPromedio: redondear(f.costo / f.encuentros),
      recaudadoPromedio: redondear(f.recaudado / f.encuentros),
      personasPromedio: Math.round((f.personas / f.encuentros) * 10) / 10,
      cobertura: porcentaje(f.recaudado, f.costo),
    }))
    .sort((a, b) => b.costoPromedio - a.costoPromedio);

  const participacionesPagas = delRango.filter((p) => p.actividad && !p.actividad.esGratuita && (p.actividad.precio ?? 0) > 0).length;

  return {
    rango: { desde, hasta },
    personas: {
      registrados: usuarios.length,
      registrosEnRango: registrosEnRango.length,
      participantes: participantes.size,
      nuevos: nuevos.length,
      vuelven: { cohorte: cohorte.length, volvieron: volvieron.length, porcentaje: porcentaje(volvieron.length, cohorte.length) },
      frecuentes,
      umbralFrecuente: UMBRAL_FRECUENTE,
      participaciones: delRango.length,
      participacionesPorPersona: participantes.size ? Math.round((delRango.length / participantes.size) * 10) / 10 : null,
      activos,
      frecuencia,
      edad,
      porMes,
      temporadas,
      cruce: {
        categorias: principales.map((nombre) => ({ nombre, color: colorDe.get(nombre) ?? null, personas: personasPorCategoria.get(nombre) })),
        matriz,
      },
      asistencia,
    },
    plata: {
      moneda: 'ARS',
      recaudado,
      recaudadoUsd,
      pagos: pagosArs.length,
      pagantes: pagadoPorPersona.size,
      pagantesPorcentaje: porcentaje(pagadoPorPersona.size, participantes.size),
      promedioPorPagante: pagadoPorPersona.size ? redondear(recaudado / pagadoPorPersona.size) : null,
      medianaPorPagante: mediana([...pagadoPorPersona.values()]),
      participacionesPagas,
      participacionesGratis: delRango.length - participacionesPagas,
      porActividad,
      gastado,
      gastosPorCategoria,
      cobertura: porcentaje(recaudado, gastado),
      porMes: meses.map((mes) => ({ mes, recaudado: recaudadoPorMes.get(mes) ?? 0, gastado: gastadoPorMes.get(mes) ?? 0 })),
      costoPorEncuentro,
    },
  };
}

/* ---------------- Una persona ---------------- */

export const DIAS_ALEJANDOSE = 45;
export const DIAS_INACTIVA = 90;
export const DIAS_NUEVA = 60;
export const FRECUENTE_EN_90_DIAS = 6;

/**
 * El estado de una persona, para entenderla de un vistazo:
 * - `sin_participar`: nunca vino.
 * - `inactiva`: hace más de 90 días que no viene.
 * - `alejandose`: venía y hace más de 45 días que no viene.
 * - `nueva`: vino por primera vez hace menos de 60 días.
 * - `frecuente`: 6 veces o más en los últimos 90 días.
 * - `ocasional`: el resto.
 * El orden importa: una persona nueva que ya no viene se está alejando.
 */
export function estadoPersona({ primera, ultima, enUltimos90, hoy }) {
  if (!ultima) return 'sin_participar';
  const diasSinVenir = Math.floor((hoy - ultima) / DIA_MS);
  if (diasSinVenir > DIAS_INACTIVA) return 'inactiva';
  if (diasSinVenir > DIAS_ALEJANDOSE) return 'alejandose';
  if ((hoy - primera) / DIA_MS < DIAS_NUEVA) return 'nueva';
  if (enUltimos90 >= FRECUENTE_EN_90_DIAS) return 'frecuente';
  return 'ocasional';
}

/**
 * Todo lo de una persona: su estado, cuánto viene, qué hace, qué pagó y su
 * historial completo de inscripciones (en cualquier estado).
 *
 * @param {Array} p.inscripciones  todas las de la persona: { _id, activityId, fecha, estado,
 *                                 asistencia, pago, createdAt, actividad: { titulo, categorias, precio, moneda } }
 */
export function resumenPersona({ inscripciones, hoy = new Date(), meses = 12 }) {
  const aceptadas = inscripciones.filter((i) => i.estado === 'aceptada');
  const pasadas = aceptadas.filter((i) => new Date(i.fecha) <= hoy);
  const participaciones = pasadas
    .filter((i) => i.asistencia !== 'falto')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  const primera = participaciones.length ? new Date(participaciones[0].fecha) : null;
  const ultima = participaciones.length ? new Date(participaciones[participaciones.length - 1].fecha) : null;
  const desde90 = hoy.getTime() - 90 * DIA_MS;
  const enUltimos90 = participaciones.filter((p) => new Date(p.fecha).getTime() >= desde90).length;
  const proximas = aceptadas.filter((i) => new Date(i.fecha) > hoy).length;

  /* Mes a mes, los últimos `meses` meses hasta hoy. */
  const inicio = DateTime.fromJSDate(hoy, { zone: 'utc' }).startOf('month').minus({ months: meses - 1 }).toJSDate();
  const porMesMapa = contarPor(
    participaciones.filter((p) => new Date(p.fecha) >= inicio),
    (p) => mesCalendario(p.fecha)
  );
  const porMes = mesesEntre(inicio, hoy).map((mes) => ({ mes, participaciones: porMesMapa.get(mes) ?? 0 }));

  const mesesActiva = primera ? Math.max(1, (hoy - primera) / (30.44 * DIA_MS)) : null;

  const porCategoria = [...contarPor(participaciones.flatMap((p) => p.actividad?.categorias ?? []), (c) => c).entries()]
    .map(([nombre, veces]) => ({ nombre, veces }))
    .sort((a, b) => b.veces - a.veces);
  const porActividad = [...contarPor(participaciones, (p) => p.actividad?.titulo ?? 'Sin título').entries()]
    .map(([titulo, veces]) => ({ titulo, veces }))
    .sort((a, b) => b.veces - a.veces)
    .slice(0, 6);

  const vino = pasadas.filter((i) => i.asistencia === 'vino').length;
  const falto = pasadas.filter((i) => i.asistencia === 'falto').length;

  const pagos = inscripciones.filter((i) => i.pago?.estadoPago === 'aprobado');
  const pagado = pagos.filter((i) => monedaDe(i) === 'ARS').reduce((t, i) => t + montoPago(i), 0);
  const pagosPendientes = inscripciones.filter((i) => i.pago?.estadoPago === 'pendiente').length;

  const historial = [...inscripciones]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .map((i) => ({
      _id: i._id,
      actividadId: i.activityId,
      titulo: i.actividad?.titulo ?? 'Actividad eliminada',
      fecha: i.fecha,
      estado: i.estado,
      asistencia: i.asistencia ?? null,
      pasada: new Date(i.fecha) <= hoy,
      pago: i.pago?.estadoPago ? { estado: i.pago.estadoPago, monto: montoPago(i), moneda: monedaDe(i) } : null,
    }));

  return {
    estado: estadoPersona({ primera, ultima, enUltimos90, hoy }),
    participaciones: participaciones.length,
    primeraVez: primera,
    ultimaVez: ultima,
    diasSinVenir: ultima ? Math.floor((hoy - ultima) / DIA_MS) : null,
    enUltimos90,
    porMesPromedio: mesesActiva ? Math.round((participaciones.length / mesesActiva) * 10) / 10 : null,
    proximas,
    inscripciones: inscripciones.length,
    canceladas: inscripciones.filter((i) => i.estado === 'cancelada').length,
    asistencia: { vino, falto, sinMarcar: pasadas.length - vino - falto, tasa: porcentaje(vino, vino + falto) },
    porMes,
    porCategoria,
    porActividad,
    plata: { pagado, pagos: pagos.length, pagosPendientes },
    historial,
  };
}
