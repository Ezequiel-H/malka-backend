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
export function calcularMetricas({ usuarios, inscripciones, gastos, ingresos = [], categorias = [], desde, hasta, hoy = new Date() }) {
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

  const usuarioPorId = new Map(usuarios.map((u) => [id(u._id), u]));
  /* La edad de alguien el día del encuentro, como la calcula la planilla. */
  const edadEnEncuentro = (p) => edadA(usuarioPorId.get(id(p.userId))?.fechaNacimiento, new Date(p.fecha));
  const promedioEdad = (lista) => {
    const edades = lista.map(edadEnEncuentro).filter((e) => e !== null);
    return edades.length ? Math.round((edades.reduce((a, b) => a + b, 0) / edades.length) * 10) / 10 : null;
  };

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
      edadPromedio: promedioEdad(lista),
      frecuencia: personas.size ? Math.round((lista.length / personas.size) * 100) / 100 : null,
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
  const edades = [...participantes].map((u) => edadA(usuarioPorId.get(u)?.fechaNacimiento, hoy)).filter((e) => e !== null);
  /* Edad promedio por propuesta, al día de cada encuentro (la hoja de
     edades de la planilla). */
  const porPropuesta = new Map();
  for (const p of delRango) for (const c of p.actividad?.categorias ?? []) {
    if (!porPropuesta.has(c)) porPropuesta.set(c, []);
    porPropuesta.get(c).push(p);
  }
  const edadPorPropuesta = [...porPropuesta.entries()]
    .map(([nombre, lista]) => ({ nombre, promedio: promedioEdad(lista), personas: new Set(lista.map((p) => id(p.userId))).size }))
    .filter((e) => e.promedio !== null)
    .sort((a, b) => b.personas - a.personas)
    .slice(0, 8);

  const edad = {
    porPropuesta: edadPorPropuesta,
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
  /* Lo que entró por fuera de los pagos de la app (la recaudación cargada a
     mano o importada de la planilla). */
  const ingresosArs = ingresos.filter((g) => (g.moneda ?? 'ARS') === 'ARS' && enRango(g.fecha));
  const recaudadoIngresos = ingresosArs.reduce((t, g) => t + g.monto, 0);
  const recaudado = pagosArs.reduce((total, i) => total + montoPago(i), 0) + recaudadoIngresos;
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
  for (const g of ingresosArs) {
    const k = String(g.actividadId ?? 'casa');
    const fila = porActividadMapa.get(k) ?? { actividadId: k, titulo: g.actividadTitulo ?? 'Ingresos de la casa', recaudado: 0, pagos: 0 };
    fila.recaudado += g.monto;
    porActividadMapa.set(k, fila);
  }
  const porActividad = [...porActividadMapa.values()].sort((a, b) => b.recaudado - a.recaudado).slice(0, 8);

  const gastosArs = gastos.filter((g) => (g.moneda ?? 'ARS') === 'ARS');
  const gastado = gastosArs.reduce((total, g) => total + g.monto, 0);
  const gastosPorCategoria = [...sumarPor(gastosArs, (g) => g.categoria ?? 'otros', (g) => g.monto).entries()]
    .map(([categoria, total]) => ({ categoria, total }))
    .sort((a, b) => b.total - a.total);
  const recaudadoPorMes = sumarPor([...pagosArs, ...ingresosArs], (i) => mesCalendario(i.fecha), (i) => ('monto' in i && !('pago' in i) ? i.monto : montoPago(i)));
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
  for (const g of ingresosArs.filter((x) => x.actividadId)) {
    const k = `${id(g.actividadId)}|${diaCalendario(g.fecha)}`;
    const e = encuentros.get(k) ?? { actividadId: id(g.actividadId), titulo: g.actividadTitulo ?? 'Sin título', costo: 0, recaudado: 0, personas: 0 };
    e.recaudado += g.monto;
    encuentros.set(k, e);
  }
  const gentePorEncuentro = new Map();
  for (const p of delRango) {
    const k = `${id(p.activityId)}|${diaCalendario(p.fecha)}`;
    const e = encuentros.get(k);
    if (e) e.personas += 1;
    if (!gentePorEncuentro.has(k)) gentePorEncuentro.set(k, []);
    gentePorEncuentro.get(k).push(p);
  }
  /* Evento por evento, con su plata y su gente (las hojas de gastos por
     evento de la planilla): se filtra por mes y categoría en la pantalla. */
  const porEvento = [...encuentros.entries()]
    .map(([k, e]) => {
      const [, dia] = k.split('|');
      const gente = gentePorEncuentro.get(k) ?? [];
      const categoria = gente[0]?.actividad?.categorias?.[0] ?? null;
      return {
        actividadId: e.actividadId,
        titulo: e.titulo,
        fecha: dia,
        mes: dia.slice(0, 7),
        categoria,
        costo: e.costo,
        recaudado: e.recaudado,
        neto: e.recaudado - e.costo,
        personas: new Set(gente.map((p) => id(p.userId))).size,
        edadPromedio: promedioEdad(gente),
      };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
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
      sinAnotarse: {
        veces: delRango.filter((p) => p.sinAnotarse).length,
        personas: new Set(delRango.filter((p) => p.sinAnotarse).map((p) => id(p.userId))).size,
      },
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
      porEvento,
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

/* ---------------- Personas en detalle ---------------- */

/**
 * Los «eventos clave» de la planilla de Malka: los Shabbat, los Shiurim y la
 * Ieshiva. Son los que dicen si alguien es parte del núcleo, más que venir
 * a una fiesta.
 */
const CLAVE_RE = /shabat|shabbat|shiur|ieshiva|yeshiva/i;
export const esEventoClave = (p) => CLAVE_RE.test(p.actividad?.titulo ?? '') || (p.actividad?.categorias ?? []).some((c) => CLAVE_RE.test(c));

/**
 * Una fila por participante con todo lo que sirve para filtrar y contestar
 * preguntas puntuales («¿cuántos extranjeros vinieron a Shabat y nunca a otra
 * cosa?»). El filtrado lo hace la pantalla: son cientos de filas, y así cada
 * filtro responde al instante.
 *
 * Lo del período (veces, propuestas, actividades, pagado) cuenta sólo el
 * rango; el estado y la primera/última vez miran toda la historia.
 *
 * También arma la retención por cohorte: de quienes vinieron por primera vez
 * en cada mes del rango, qué parte volvió en el mes siguiente, a los dos y a
 * los tres.
 */
export function personasDetalle({ usuarios, inscripciones, desde, hasta, hoy = new Date() }) {
  const { inicio, fin } = limitesDias(desde, hasta);
  const finEfectivo = fin < hoy ? fin : hoy;
  const enRango = (f) => {
    const t = new Date(f).getTime();
    return t >= inicio.getTime() && t <= finEfectivo.getTime();
  };

  const porPersona = new Map();
  for (const i of inscripciones) {
    const k = String(i.userId);
    if (!porPersona.has(k)) porPersona.set(k, []);
    porPersona.get(k).push(i);
  }

  const filas = usuarios.map((u) => {
    const propias = porPersona.get(String(u._id)) ?? [];
    const participaciones = propias
      .filter((i) => i.estado === 'aceptada' && new Date(i.fecha) <= hoy && i.asistencia !== 'falto')
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const primera = participaciones.length ? new Date(participaciones[0].fecha) : null;
    const ultima = participaciones.length ? new Date(participaciones[participaciones.length - 1].fecha) : null;
    const enUltimos90 = participaciones.filter((p) => hoy - new Date(p.fecha) <= 90 * DIA_MS).length;
    const delRango = participaciones.filter((p) => enRango(p.fecha));
    const pagos = propias.filter((i) => i.pago?.estadoPago === 'aprobado' && enRango(i.fecha) && monedaDe(i) === 'ARS');
    const ultimaParticipacion = participaciones[participaciones.length - 1];

    return {
      id: String(u._id),
      nombre: [u.nombre, u.apellido].filter(Boolean).join(' '),
      email: u.email,
      telefono: u.telefono ?? null,
      edad: edadA(u.fechaNacimiento, hoy),
      nacionalidad: u.nacionalidad ?? null,
      residencia: u.residencia ?? null,
      ciudad: u.ciudad ?? null,
      comoSeEntero: u.comoSeEntero?.trim() || null,
      idioma: u.idioma ?? 'es',
      tipoDocumento: u.tipoDocumento ?? 'dni',
      estadoCuenta: u.estado,
      alta: u.createdAt,
      estado: estadoPersona({ primera, ultima, enUltimos90, hoy }),
      primeraVez: primera,
      ultimaVez: ultima,
      nuevaEnRango: Boolean(primera && enRango(primera)),
      veces: delRango.length,
      vecesTotal: participaciones.length,
      categorias: [...new Set(delRango.flatMap((p) => p.actividad?.categorias ?? []))],
      actividades: [...new Set(delRango.map((p) => String(p.activityId)))],
      pagado: pagos.reduce((t, i) => t + montoPago(i), 0),
      ultimoEncuentro: ultimaParticipacion?.actividad?.titulo ?? null,
      vecesClave: delRango.filter(esEventoClave).length,
      sinAnotarse: delRango.filter((p) => p.sinAnotarse).length,
      esContacto: Boolean(u.esContacto),
    };
  });

  /* Cohortes por mes de primera visita. Un mes sólo se informa cuando ya
     pasó entero (si no, todavía no se sabe si volvieron). */
  const cohortes = mesesEntre(inicio, fin).map((mes) => {
    const gente = filas.filter((f) => f.primeraVez && mesCalendario(f.primeraVez) === mes);
    const despues = [1, 2, 3].map((n) => {
      const objetivo = DateTime.fromISO(`${mes}-01`, { zone: 'utc' }).plus({ months: n });
      if (objetivo.endOf('month').toJSDate() > hoy) return null;
      const clave = objetivo.toFormat('yyyy-MM');
      const volvieron = gente.filter((f) =>
        (porPersona.get(f.id) ?? []).some(
          (i) => i.estado === 'aceptada' && i.asistencia !== 'falto' && mesCalendario(i.fecha) === clave
        )
      ).length;
      return porcentaje(volvieron, gente.length);
    });
    return { mes, personas: gente.length, despues };
  });

  return { personas: filas, cohortes };
}

/* ---------------- Actividades ---------------- */

const resumenDeInscripciones = (propias, { hoy, enRango, primeraVezMalka, gastosPorDia, ingresosPorDia = new Map(), cupo }) => {
  const delRango = propias.filter((i) => enRango(i.fecha));
  const pasadas = delRango.filter((i) => new Date(i.fecha) <= hoy);
  const aceptadas = pasadas.filter((i) => i.estado === 'aceptada');
  const participaciones = aceptadas.filter((i) => i.asistencia !== 'falto');
  const encuentros = [...new Set(aceptadas.map((i) => diaCalendario(i.fecha)))];
  const personas = new Set(participaciones.map((i) => String(i.userId)));
  const vecesPorPersona = contarPor(participaciones, (i) => String(i.userId));
  const repiten = [...vecesPorPersona.values()].filter((n) => n >= 2).length;
  /* Puerta de entrada: la primera vez en Malka de esa persona fue en esta
     actividad, dentro del período. */
  const puerta = participaciones.filter((i) => {
    const primera = primeraVezMalka.get(String(i.userId));
    return primera && primera.id === String(i._id);
  }).length;
  const vino = aceptadas.filter((i) => i.asistencia === 'vino').length;
  const falto = aceptadas.filter((i) => i.asistencia === 'falto').length;
  const pagos = delRango.filter((i) => i.pago?.estadoPago === 'aprobado' && monedaDe(i) === 'ARS');
  const sumaDelRango = (porDia) =>
    [...porDia.entries()].filter(([dia]) => enRango(new Date(`${dia}T00:00:00.000Z`))).reduce((t, [, m]) => t + m, 0);
  const recaudado = pagos.reduce((t, i) => t + montoPago(i), 0) + sumaDelRango(ingresosPorDia);
  const costo = [...gastosPorDia.entries()].filter(([dia]) => enRango(new Date(`${dia}T00:00:00.000Z`))).reduce((t, [, m]) => t + m, 0);
  const porEncuentro = encuentros.length ? participaciones.length / encuentros.length : null;
  return {
    encuentros: encuentros.length,
    participaciones: participaciones.length,
    personas: personas.size,
    porEncuentro: porEncuentro === null ? null : Math.round(porEncuentro * 10) / 10,
    ocupacion: cupo && porEncuentro !== null ? porcentaje(porEncuentro, cupo) : null,
    repiten,
    repitenPorcentaje: porcentaje(repiten, personas.size),
    puertaDeEntrada: puerta,
    asistencia: { vino, falto, tasa: porcentaje(vino, vino + falto) },
    canceladas: delRango.filter((i) => i.estado === 'cancelada').length,
    enEspera: delRango.filter((i) => i.estado === 'en_espera').length,
    recaudado,
    costo,
    cobertura: porcentaje(recaudado, costo),
  };
};

const prepararActividades = ({ inscripciones, gastos, hoy }) => {
  /* La primera participación de cada persona en toda Malka (para «puerta de
     entrada»). */
  const primeraVezMalka = new Map();
  for (const i of inscripciones) {
    if (i.estado !== 'aceptada' || i.asistencia === 'falto' || new Date(i.fecha) > hoy) continue;
    const k = String(i.userId);
    const actual = primeraVezMalka.get(k);
    if (!actual || new Date(i.fecha) < actual.fecha) primeraVezMalka.set(k, { fecha: new Date(i.fecha), id: String(i._id) });
  }
  /* Gastos e ingresos (lo cobrado por fuera de la app) por actividad y día. */
  const gastosPorActividad = new Map();
  const ingresosPorActividad = new Map();
  for (const g of gastos) {
    if (!g.actividadId || (g.moneda ?? 'ARS') !== 'ARS') continue;
    const destino = g.tipo === 'ingreso' ? ingresosPorActividad : gastosPorActividad;
    const k = String(g.actividadId);
    if (!destino.has(k)) destino.set(k, new Map());
    const dia = diaCalendario(g.fecha);
    destino.get(k).set(dia, (destino.get(k).get(dia) ?? 0) + g.monto);
  }
  const porActividad = new Map();
  for (const i of inscripciones) {
    const k = String(i.activityId);
    if (!porActividad.has(k)) porActividad.set(k, []);
    porActividad.get(k).push(i);
  }
  return { primeraVezMalka, gastosPorActividad, ingresosPorActividad, porActividad };
};

/**
 * Una fila por actividad con sus números del período, para el ranking.
 * Las inscripciones vienen en todos los estados (para contar cancelaciones y
 * lista de espera); los gastos, de toda la historia de esas actividades.
 */
export function metricasActividades({ actividades, inscripciones, gastos, desde, hasta, hoy = new Date() }) {
  const { inicio, fin } = limitesDias(desde, hasta);
  const enRango = (f) => {
    const t = new Date(f).getTime();
    return t >= inicio.getTime() && t <= fin.getTime();
  };
  const { primeraVezMalka, gastosPorActividad, ingresosPorActividad, porActividad } = prepararActividades({ inscripciones, gastos, hoy });
  return actividades
    .map((a) => ({
      id: String(a._id),
      titulo: a.titulo,
      tipo: a.tipo,
      categorias: a.categorias ?? [],
      gratuita: Boolean(a.esGratuita) || !(a.precio > 0),
      cupo: a.cupo ?? null,
      ...resumenDeInscripciones(porActividad.get(String(a._id)) ?? [], {
        hoy,
        enRango,
        primeraVezMalka,
        gastosPorDia: gastosPorActividad.get(String(a._id)) ?? new Map(),
        ingresosPorDia: ingresosPorActividad.get(String(a._id)) ?? new Map(),
        cupo: a.cupo,
      }),
    }))
    .filter((f) => f.encuentros > 0 || f.canceladas > 0 || f.enEspera > 0);
}

/**
 * Todo de una actividad: sus números, cada encuentro, quiénes vienen más,
 * qué más hace su gente y la edad.
 */
export function metricasActividad({ actividad, inscripciones, todas, gastos, usuarios, desde, hasta, hoy = new Date() }) {
  const { inicio, fin } = limitesDias(desde, hasta);
  const enRango = (f) => {
    const t = new Date(f).getTime();
    return t >= inicio.getTime() && t <= fin.getTime();
  };
  const id = String(actividad._id);
  const { primeraVezMalka, gastosPorActividad, ingresosPorActividad } = prepararActividades({ inscripciones: todas, gastos, hoy });
  const gastosPorDia = gastosPorActividad.get(id) ?? new Map();
  const ingresosPorDia = ingresosPorActividad.get(id) ?? new Map();
  const resumen = resumenDeInscripciones(inscripciones, { hoy, enRango, primeraVezMalka, gastosPorDia, ingresosPorDia, cupo: actividad.cupo });

  const delRango = inscripciones.filter((i) => enRango(i.fecha));
  const porDia = new Map();
  for (const i of delRango) {
    const dia = diaCalendario(i.fecha);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(i);
  }
  const encuentros = [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, lista]) => {
      const aceptadas = lista.filter((i) => i.estado === 'aceptada');
      const pasado = new Date(`${dia}T00:00:00.000Z`) <= hoy;
      return {
        fecha: dia,
        pasado,
        aceptadas: aceptadas.length,
        vinieron: aceptadas.filter((i) => i.asistencia === 'vino').length,
        faltaron: aceptadas.filter((i) => i.asistencia === 'falto').length,
        nuevas: aceptadas.filter((i) => primeraVezMalka.get(String(i.userId))?.id === String(i._id)).length,
        enEspera: lista.filter((i) => i.estado === 'en_espera').length,
        canceladas: lista.filter((i) => i.estado === 'cancelada').length,
        recaudado:
          lista.filter((i) => i.pago?.estadoPago === 'aprobado' && monedaDe(i) === 'ARS').reduce((t, i) => t + montoPago(i), 0) +
          (ingresosPorDia.get(dia) ?? 0),
        costo: gastosPorDia.get(dia) ?? 0,
      };
    });

  const participaciones = delRango.filter((i) => i.estado === 'aceptada' && i.asistencia !== 'falto' && new Date(i.fecha) <= hoy);
  const usuarioPorId = new Map(usuarios.map((u) => [String(u._id), u]));
  const veces = contarPor(participaciones, (i) => String(i.userId));
  const habituales = [...veces.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([u, n]) => {
      const persona = usuarioPorId.get(u);
      return { id: u, nombre: [persona?.nombre, persona?.apellido].filter(Boolean).join(' ') || 'Sin nombre', veces: n };
    });

  /* Qué más hace la gente de esta actividad, en el mismo período. */
  const suGente = new Set(veces.keys());
  const otras = contarPor(
    todas.filter(
      (i) =>
        suGente.has(String(i.userId)) &&
        String(i.activityId) !== id &&
        i.estado === 'aceptada' &&
        i.asistencia !== 'falto' &&
        enRango(i.fecha) &&
        new Date(i.fecha) <= hoy
    ),
    (i) => `${i.userId}|${i.activityId}`
  );
  const personasPorOtra = contarPor([...otras.keys()], (k) => k.split('|')[1]);
  const tambienHacen = [...personasPorOtra.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([actividadId, personas]) => ({ actividadId, personas, porcentaje: porcentaje(personas, suGente.size) }));

  const edades = [...suGente].map((u) => edadA(usuarioPorId.get(u)?.fechaNacimiento, hoy)).filter((e) => e !== null);

  return {
    actividad: {
      id,
      titulo: actividad.titulo,
      tipo: actividad.tipo,
      categorias: actividad.categorias ?? [],
      cupo: actividad.cupo ?? null,
      gratuita: Boolean(actividad.esGratuita) || !(actividad.precio > 0),
      precio: actividad.precio ?? 0,
    },
    resumen,
    encuentros,
    habituales,
    tambienHacen,
    edad: {
      promedio: edades.length ? Math.round((edades.reduce((a, b) => a + b, 0) / edades.length) * 10) / 10 : null,
      tramos: TRAMOS_EDAD.map((t) => ({ id: t.id, etiqueta: t.etiqueta, personas: edades.filter((e) => e >= t.min && e <= t.max).length })),
    },
  };
}
