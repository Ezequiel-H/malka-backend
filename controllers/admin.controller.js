import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import Inscription from '../models/Inscription.model.js';
import User from '../models/User.model.js';
import Activity from '../models/Activity.model.js';
import Gasto from '../models/Gasto.model.js';
import Tag from '../models/Tag.model.js';
import { calcularMetricas, limitesDias, metricasActividad, metricasActividades, personasDetalle, resumenPersona } from '../utils/metricas.js';
import { ARGENTINA_TZ, parseArgentinaDayBounds } from '../utils/argentinaTime.js';
import { birthdayWindow, describeBirthday, monthDaysInWindow } from '../utils/birthdayWindow.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const TOP_LIMIT_MAX = 50;

/** Días mínimos desde la primera inscripción (en actividad no eliminada) para entrar en la cohorte de retorno. */
export const FIRST_INSCRIPTION_COHORT_MIN_DAYS = 15;
const MS_PER_DAY = 86400000;

/**
 * GET /api/admin/inscription-stats
 * - weeklyNewInscriptions: nuevas inscripciones por semana ISO (lunes); fecha de alta = $ifNull(createdAt, fechaInscripcion); sin actividades eliminadas
 * - topOccurrencesAccepted: top por (activityId + día de ocurrencia), solo aceptadas en rango; sin actividades eliminadas
 */
export const getInscriptionStats = async (req, res) => {
  try {
    const { from, to, activityId } = req.query;
    const topLimit = Math.min(
      Math.max(parseInt(String(req.query.limit || '10'), 10) || 10, 1),
      TOP_LIMIT_MAX
    );

    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return res.status(400).json({
        message: 'Parámetros from y to obligatorios en formato YYYY-MM-DD'
      });
    }

    const { fromStart, toEnd } = parseArgentinaDayBounds(from, to);
    if (Number.isNaN(fromStart.getTime()) || Number.isNaN(toEnd.getTime())) {
      return res.status(400).json({ message: 'Fechas inválidas' });
    }
    if (fromStart > toEnd) {
      return res.status(400).json({ message: 'from debe ser anterior o igual a to' });
    }

    const spanDays = (toEnd.getTime() - fromStart.getTime()) / 86400000;
    if (spanDays > MAX_RANGE_DAYS) {
      return res.status(400).json({ message: `El rango no puede superar ${MAX_RANGE_DAYS} días` });
    }

    let activityObjectId = null;
    if (activityId !== undefined && activityId !== '' && activityId !== null) {
      if (!mongoose.Types.ObjectId.isValid(activityId)) {
        return res.status(400).json({ message: 'activityId inválido' });
      }
      activityObjectId = new mongoose.Types.ObjectId(activityId);
    }

    const activityMatch = activityObjectId ? { activityId: activityObjectId } : {};

    const weeklyPipeline = [
      { $match: activityMatch },
      {
        $lookup: {
          from: 'activities',
          let: { aid: '$activityId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$_id', '$$aid'] },
                estado: { $ne: 'eliminada' }
              }
            },
            { $limit: 1 }
          ],
          as: '_activityOk'
        }
      },
      {
        $match: {
          $expr: { $gt: [{ $size: '$_activityOk' }, 0] }
        }
      },
      {
        $addFields: {
          newInscriptionAt: { $ifNull: ['$createdAt', '$fechaInscripcion'] }
        }
      },
      {
        $match: {
          newInscriptionAt: { $gte: fromStart, $lte: toEnd }
        }
      },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$newInscriptionAt',
              unit: 'week',
              timezone: ARGENTINA_TZ,
              startOfWeek: 'monday'
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          weekStart: '$_id',
          count: 1
        }
      }
    ];

    const topOccurrencesPipeline = [
      {
        $match: {
          estado: 'aceptada',
          fecha: { $gte: fromStart, $lte: toEnd }
        }
      },
      {
        $lookup: {
          from: 'activities',
          let: { aid: '$activityId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$_id', '$$aid'] },
                estado: { $ne: 'eliminada' }
              }
            },
            { $project: { titulo: 1, tipo: 1 } }
          ],
          as: 'activity'
        }
      },
      {
        $match: {
          $expr: { $gt: [{ $size: '$activity' }, 0] }
        }
      },
      {
        $group: {
          _id: {
            activityId: '$activityId',
            occurrenceDate: {
              $dateToString: { format: '%Y-%m-%d', date: '$fecha', timezone: 'UTC' }
            }
          },
          count: { $sum: 1 },
          titulo: { $first: { $arrayElemAt: ['$activity.titulo', 0] } },
          tipo: { $first: { $arrayElemAt: ['$activity.tipo', 0] } }
        }
      },
      { $sort: { count: -1 } },
      { $limit: topLimit },
      {
        $project: {
          _id: 0,
          activityId: '$_id.activityId',
          occurrenceDate: '$_id.occurrenceDate',
          count: 1,
          titulo: { $ifNull: ['$titulo', ''] },
          tipo: { $ifNull: ['$tipo', 'unica'] }
        }
      }
    ];

    const [weeklyRaw, topOccurrencesAccepted] = await Promise.all([
      Inscription.aggregate(weeklyPipeline),
      Inscription.aggregate(topOccurrencesPipeline)
    ]);

    const weeklyNewInscriptions = weeklyRaw.map((row) => {
      const weekStart = row.weekStart instanceof Date ? row.weekStart.toISOString() : row.weekStart;
      const weekLabelAr = DateTime.fromJSDate(new Date(weekStart))
        .setZone(ARGENTINA_TZ)
        .toFormat('dd/MM/yyyy');
      const weekLabel = `Semana del ${weekLabelAr}`;
      return {
        weekStart,
        weekLabel,
        count: row.count
      };
    });

    res.json({
      weeklyNewInscriptions,
      topOccurrencesAccepted,
      meta: {
        from,
        to,
        timeZone: ARGENTINA_TZ,
        weekConvention: `Semana ISO, inicio lunes ($dateTrunc, ${ARGENTINA_TZ})`,
        newInscriptionTimestampField: '$ifNull(createdAt, fechaInscripcion)',
        topRanking:
          'Inscripciones aceptadas por actividad y día de ocurrencia (fecha de clase) dentro del rango; sin actividades eliminadas. Serie semanal sin actividades eliminadas.',
        occurrenceDateConvention:
          'Día de clase en calendario UTC ($dateToString UTC), alineado con listas de inscripciones y parámetro ?fecha='
      }
    });
  } catch (error) {
    console.error('Error en getInscriptionStats:', error);
    res.status(500).json({ message: 'Error al obtener estadísticas', error: error.message });
  }
};

const activityNotDeletedLookup = {
  $lookup: {
    from: 'activities',
    let: { aid: '$activityId' },
    pipeline: [
      {
        $match: {
          $expr: { $eq: ['$_id', '$$aid'] },
          estado: { $ne: 'eliminada' }
        }
      },
      { $limit: 1 }
    ],
    as: '_activityOk'
  }
};

/**
 * GET /api/admin/first-inscription-repeat-stats
 * Cohorte: usuarios cuya primera inscripción (fecha de alta, actividades no eliminadas) fue hace al menos N días.
 * Retorno: entre ellos, cuántos tienen más de un registro de inscripción en total (misma regla de actividades).
 */
export const getFirstInscriptionRepeatStats = async (req, res) => {
  try {
    const now = Date.now();
    const threshold = new Date(now - FIRST_INSCRIPTION_COHORT_MIN_DAYS * MS_PER_DAY);

    const pipeline = [
      activityNotDeletedLookup,
      {
        $match: {
          $expr: { $gt: [{ $size: '$_activityOk' }, 0] }
        }
      },
      {
        $addFields: {
          newInscriptionAt: { $ifNull: ['$createdAt', '$fechaInscripcion'] }
        }
      },
      {
        $group: {
          _id: '$userId',
          firstInscriptionAt: { $min: '$newInscriptionAt' },
          inscriptionCount: { $sum: 1 }
        }
      },
      {
        $match: {
          firstInscriptionAt: { $lte: threshold }
        }
      },
      {
        $group: {
          _id: null,
          cohortSize: { $sum: 1 },
          withMoreThanOneInscription: {
            $sum: {
              $cond: [{ $gt: ['$inscriptionCount', 1] }, 1, 0]
            }
          }
        }
      }
    ];

    const rows = await Inscription.aggregate(pipeline);
    const row = rows[0] || { cohortSize: 0, withMoreThanOneInscription: 0 };
    const cohortSize = row.cohortSize || 0;
    const withMoreThanOneInscription = row.withMoreThanOneInscription || 0;
    const rate = cohortSize > 0 ? withMoreThanOneInscription / cohortSize : null;

    res.json({
      minDaysSinceFirstInscription: FIRST_INSCRIPTION_COHORT_MIN_DAYS,
      cohortSize,
      withMoreThanOneInscription,
      rate
    });
  } catch (error) {
    console.error('Error en getFirstInscriptionRepeatStats:', error);
    res.status(500).json({ message: 'Error al obtener estadísticas de retorno', error: error.message });
  }
};

/**
 * GET /api/admin/birthdays
 *
 * Los cumpleaños de esta semana y la siguiente, para que el panel pueda saludar.
 * Devuelve participantes aprobados; quien todavía no cargó la fecha no aparece
 * (se cuenta aparte en `sinFecha`, para que el vacío se explique).
 */
export const getUpcomingBirthdays = async (req, res) => {
  try {
    const hoyISO = DATE_RE.test(String(req.query.hoy || '')) ? req.query.hoy : null;
    const dias = monthDaysInWindow(hoyISO);

    const base = { role: 'participant', estado: 'approved' };

    const [candidatos, sinFecha] = await Promise.all([
      User.find({
        ...base,
        // Se filtra por 'MM-DD' en la base para no traerse el padrón entero:
        // la ventana son 15 días, así que la lista de días es corta.
        $expr: { $in: [{ $substrBytes: [{ $ifNull: ['$fechaNacimiento', ''] }, 5, 5] }, dias] }
      })
        .select('nombre apellido email telefono fechaNacimiento')
        .lean(),
      User.countDocuments({
        ...base,
        $or: [{ fechaNacimiento: { $exists: false } }, { fechaNacimiento: '' }, { fechaNacimiento: null }]
      })
    ]);

    const cumpleanios = candidatos
      .map((u) => {
        const detalle = describeBirthday(u.fechaNacimiento, hoyISO);
        return detalle ? { ...u, ...detalle } : null;
      })
      // El $expr trae el día correcto pero no sabe de años: el 31 de diciembre
      // la ventana toca enero, y describeBirthday es quien resuelve cuál cae.
      .filter(Boolean)
      .sort(
        (a, b) =>
          a.fecha.localeCompare(b.fecha) ||
          `${a.nombre} ${a.apellido}`.localeCompare(`${b.nombre} ${b.apellido}`, 'es', {
            sensitivity: 'base'
          })
      );

    const { desde, hasta, finDeEstaSemana } = birthdayWindow(hoyISO);

    res.json({
      desde: desde.toFormat('yyyy-MM-dd'),
      hasta: hasta.toFormat('yyyy-MM-dd'),
      finDeEstaSemana: finDeEstaSemana.toFormat('yyyy-MM-dd'),
      hoy: cumpleanios.filter((c) => c.esHoy),
      estaSemana: cumpleanios.filter((c) => !c.esHoy && c.semana === 'esta'),
      proximaSemana: cumpleanios.filter((c) => c.semana === 'proxima'),
      total: cumpleanios.length,
      sinFecha
    });
  } catch (error) {
    console.error('Error al obtener próximos cumpleaños:', error);
    res
      .status(500)
      .json({ message: 'Error al obtener próximos cumpleaños', error: error.message });
  }
};

const METRICAS_MAX_DIAS = 731;

/**
 * GET /api/admin/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Las métricas del tablero del equipo (personas y plata). Trae las
 * inscripciones aceptadas de toda la historia porque «primera vez» y «vuelven»
 * miran hacia atrás del rango; la cuenta vive en utils/metricas.js.
 */
export const getMetrics = async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return res.status(400).json({ message: 'Parámetros from y to obligatorios en formato YYYY-MM-DD' });
    }
    const { inicio, fin } = limitesDias(from, to);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      return res.status(400).json({ message: 'Fechas inválidas' });
    }
    if (inicio > fin) {
      return res.status(400).json({ message: 'from debe ser anterior o igual a to' });
    }
    if ((fin - inicio) / MS_PER_DAY > METRICAS_MAX_DIAS) {
      return res.status(400).json({ message: `El rango no puede superar ${METRICAS_MAX_DIAS} días` });
    }

    const [usuarios, actividades, inscripciones, gastos, categorias] = await Promise.all([
      User.find({ role: 'participant' }).select('createdAt fechaNacimiento').lean(),
      Activity.find({ estado: { $ne: 'eliminada' } }).select('titulo categorias precio moneda esGratuita').lean(),
      Inscription.find({ estado: 'aceptada' }).select('userId activityId fecha asistencia pago.estadoPago pago.montoEsperado').lean(),
      Gasto.find({ fecha: { $gte: inicio, $lte: fin } }).populate('actividadId', 'titulo').lean(),
      Tag.find().select('nombre color').lean()
    ]);

    const actividadPorId = new Map(actividades.map((a) => [String(a._id), a]));
    const metricas = calcularMetricas({
      usuarios,
      inscripciones: inscripciones
        .map((i) => ({ ...i, actividad: actividadPorId.get(String(i.activityId)) }))
        .filter((i) => i.actividad),
      gastos: gastos.map((g) => ({
        ...g,
        actividadId: g.actividadId?._id ?? null,
        actividadTitulo: g.actividadId?.titulo
      })),
      categorias,
      desde: from,
      hasta: to,
      hoy: new Date()
    });
    res.json(metricas);
  } catch (error) {
    res.status(500).json({ message: 'Error al calcular las métricas', error: error.message });
  }
};

/**
 * GET /api/admin/users/:id/metrics — el resumen de una persona para su ficha:
 * estado, cuánto viene, qué hace, qué pagó y su historial.
 */
export const getUserMetrics = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    const usuario = await User.findById(req.params.id).select('_id').lean();
    if (!usuario) return res.status(404).json({ message: 'Usuario no encontrado' });

    const inscripciones = await Inscription.find({ userId: req.params.id })
      .select('activityId fecha estado asistencia pago.estadoPago pago.montoEsperado createdAt')
      .lean();
    const actividades = await Activity.find({ _id: { $in: inscripciones.map((i) => i.activityId) } })
      .select('titulo categorias precio moneda estado')
      .lean();
    const actividadPorId = new Map(actividades.map((a) => [String(a._id), a]));

    res.json(
      resumenPersona({
        inscripciones: inscripciones.map((i) => ({ ...i, actividad: actividadPorId.get(String(i.activityId)) })),
        hoy: new Date()
      })
    );
  } catch (error) {
    res.status(500).json({ message: 'Error al calcular el resumen de la persona', error: error.message });
  }
};

/**
 * GET /api/admin/metrics/people?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Una fila por participante para filtrar en la pantalla «En detalle», más la
 * retención por cohorte y los catálogos (actividades y categorías) de los
 * filtros.
 */
export const getPeopleMetrics = async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return res.status(400).json({ message: 'Parámetros from y to obligatorios en formato YYYY-MM-DD' });
    }
    const { inicio, fin } = limitesDias(from, to);
    if (inicio > fin || (fin - inicio) / MS_PER_DAY > METRICAS_MAX_DIAS) {
      return res.status(400).json({ message: 'Rango inválido' });
    }

    const [usuarios, actividades, inscripciones, categorias] = await Promise.all([
      User.find({ role: 'participant' })
        .select('nombre apellido email telefono fechaNacimiento nacionalidad residencia ciudad comoSeEntero idioma tipoDocumento estado createdAt')
        .lean(),
      Activity.find({ estado: { $ne: 'eliminada' } }).select('titulo categorias precio moneda').lean(),
      Inscription.find({ estado: 'aceptada' }).select('userId activityId fecha estado asistencia pago.estadoPago pago.montoEsperado').lean(),
      Tag.find().select('nombre color').lean()
    ]);
    const actividadPorId = new Map(actividades.map((a) => [String(a._id), a]));
    const { personas, cohortes } = personasDetalle({
      usuarios,
      inscripciones: inscripciones
        .map((i) => ({ ...i, actividad: actividadPorId.get(String(i.activityId)) }))
        .filter((i) => i.actividad),
      desde: from,
      hasta: to,
      hoy: new Date()
    });

    res.json({
      personas,
      cohortes,
      actividades: actividades.map((a) => ({ id: String(a._id), titulo: a.titulo })),
      categorias: categorias.map((c) => ({ nombre: c.nombre, color: c.color ?? null }))
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al armar el detalle de personas', error: error.message });
  }
};

const leerRango = (req, res) => {
  const { from, to } = req.query;
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    res.status(400).json({ message: 'Parámetros from y to obligatorios en formato YYYY-MM-DD' });
    return null;
  }
  const { inicio, fin } = limitesDias(from, to);
  if (inicio > fin || (fin - inicio) / MS_PER_DAY > METRICAS_MAX_DIAS) {
    res.status(400).json({ message: 'Rango inválido' });
    return null;
  }
  return { from, to };
};

const CAMPOS_INSCRIPCION = 'userId activityId fecha estado asistencia pago.estadoPago pago.montoEsperado';

/** GET /api/admin/metrics/activities?from&to — el ranking de actividades. */
export const getActivitiesMetrics = async (req, res) => {
  try {
    const rango = leerRango(req, res);
    if (!rango) return;
    const [actividades, inscripciones, gastos] = await Promise.all([
      Activity.find({ estado: { $ne: 'eliminada' } }).select('titulo tipo categorias precio moneda esGratuita cupo').lean(),
      Inscription.find().select(CAMPOS_INSCRIPCION).lean(),
      Gasto.find({ actividadId: { $ne: null } }).select('fecha monto moneda actividadId').lean()
    ]);
    const actividadPorId = new Map(actividades.map((a) => [String(a._id), a]));
    res.json({
      actividades: metricasActividades({
        actividades,
        inscripciones: inscripciones.map((i) => ({ ...i, actividad: actividadPorId.get(String(i.activityId)) })),
        gastos,
        desde: rango.from,
        hasta: rango.to,
        hoy: new Date()
      })
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al calcular las métricas de actividades', error: error.message });
  }
};

/** GET /api/admin/metrics/activities/:id?from&to — la ficha de una actividad. */
export const getActivityMetrics = async (req, res) => {
  try {
    const rango = leerRango(req, res);
    if (!rango) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: 'Actividad no encontrada' });
    const actividad = await Activity.findById(req.params.id).lean();
    if (!actividad) return res.status(404).json({ message: 'Actividad no encontrada' });
    const [actividades, todas, gastos] = await Promise.all([
      Activity.find().select('titulo precio moneda').lean(),
      Inscription.find().select(CAMPOS_INSCRIPCION).lean(),
      Gasto.find({ actividadId: actividad._id }).select('fecha monto moneda actividadId').lean()
    ]);
    const actividadPorId = new Map(actividades.map((a) => [String(a._id), a]));
    const conActividad = todas.map((i) => ({ ...i, actividad: actividadPorId.get(String(i.activityId)) }));
    const propias = conActividad.filter((i) => String(i.activityId) === String(actividad._id));
    const usuarios = await User.find({ _id: { $in: [...new Set(propias.map((i) => String(i.userId)))] } })
      .select('nombre apellido fechaNacimiento')
      .lean();
    const datos = metricasActividad({
      actividad,
      inscripciones: propias,
      todas: conActividad,
      gastos,
      usuarios,
      desde: rango.from,
      hasta: rango.to,
      hoy: new Date()
    });
    datos.tambienHacen = datos.tambienHacen.map((t) => ({ ...t, titulo: actividadPorId.get(String(t.actividadId))?.titulo ?? 'Actividad eliminada' }));
    res.json(datos);
  } catch (error) {
    res.status(500).json({ message: 'Error al calcular las métricas de la actividad', error: error.message });
  }
};
