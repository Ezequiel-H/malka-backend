import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import Inscription from '../models/Inscription.model.js';
import { ARGENTINA_TZ, parseArgentinaDayBounds } from '../utils/argentinaTime.js';

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
