import Inscription from '../models/Inscription.model.js';
import Activity from '../models/Activity.model.js';
import User from '../models/User.model.js';
import { calculateOccurrences } from '../utils/generateOccurrences.js';
import { participantActivityAccessDenied } from '../utils/participantActivityAccess.js';
import { uploadToCloudinary } from '../middleware/upload.middleware.js';

const isPaidActivity = (activity) => activity && activity.esGratuita === false;

const buildPagoFromFile = async (file, activity) => {
  const comprobante = await uploadToCloudinary(
    file.buffer,
    file.originalname,
    file.mimetype
  );
  return {
    comprobante,
    estadoPago: 'pendiente',
    montoEsperado: activity.precio,
  };
};

const determineInitialEstado = (activity, cupoFull) => {
  if (cupoFull) return 'en_espera';
  if (isPaidActivity(activity)) return 'pendiente';
  return activity.requiereAprobacion ? 'pendiente' : 'aceptada';
};

const paidInscriptionMessage = (estado) => {
  if (estado === 'en_espera') {
    return 'Cupo completo. Has sido agregado a la lista de espera. Tu comprobante quedará pendiente de revisión.';
  }
  return 'Inscripción enviada. Queda pendiente hasta que se apruebe el comprobante de transferencia.';
};

const freeInscriptionMessage = (activity, estado) => {
  if (estado === 'en_espera') {
    return 'Cupo completo. Has sido agregado a la lista de espera.';
  }
  return activity.requiereAprobacion
    ? 'Inscripción realizada. Pendiente de aprobación.'
    : 'Inscripción realizada exitosamente';
};

/**
 * Obtiene las fechas disponibles para inscribirse a una actividad recurrente
 * Incluye el estado de inscripción del usuario para cada fecha
 */
export const getAvailableDates = async (req, res) => {
  try {
    const { activityId } = req.params;
    const userId = req.user._id;

    // Verificar que la actividad existe
    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ message: 'Actividad no encontrada' });
    }

    // Verificar que la actividad está publicada
    if (activity.estado !== 'publicada') {
      return res.status(400).json({ message: 'La actividad no está disponible para inscripción' });
    }

    const accessDenied = participantActivityAccessDenied(req, activity);
    if (accessDenied) {
      return res.status(accessDenied.status).json(accessDenied.body);
    }

    // Obtener todas las inscripciones futuras del usuario para esta actividad
    // Buscar sin filtrar por fecha para obtener todas las inscripciones de esta actividad
    const userInscriptions = await Inscription.find({
      userId: userId,
      activityId: activity._id,
      estado: { $in: ['pendiente', 'aceptada', 'en_espera'] }
    });

    // Crear un mapa de fecha -> estado de inscripción
    const inscriptionMap = new Map();
    userInscriptions.forEach(inscription => {
      // Normalizar la fecha a string YYYY-MM-DD para comparación
      // Usar UTC para evitar problemas de zona horaria
      const fechaDate = new Date(inscription.fecha);
      // Obtener año, mes y día en UTC para evitar problemas de zona horaria
      const year = fechaDate.getUTCFullYear();
      const month = String(fechaDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(fechaDate.getUTCDate()).padStart(2, '0');
      const fechaStr = `${year}-${month}-${day}`;
      inscriptionMap.set(fechaStr, inscription.estado);
    });

    let availableDates = [];

    if (activity.tipo === 'recurrente') {
      // Calcular ocurrencias de los próximos 30 días
      const occurrences = calculateOccurrences(activity, 30);
      
      // Para cada ocurrencia, calcular cupos disponibles y estado de inscripción
      availableDates = await Promise.all(
        occurrences.map(async (occ) => {
          // Normalizar fecha usando UTC para evitar problemas de zona horaria
          const fechaDate = new Date(occ.fecha);
          const year = fechaDate.getUTCFullYear();
          const month = String(fechaDate.getUTCMonth() + 1).padStart(2, '0');
          const day = String(fechaDate.getUTCDate()).padStart(2, '0');
          const fechaStr = `${year}-${month}-${day}`;
          
          const fechaStart = new Date(occ.fecha);
          fechaStart.setUTCHours(0, 0, 0, 0);
          const fechaEnd = new Date(occ.fecha);
          fechaEnd.setUTCHours(23, 59, 59, 999);

          // Contar inscripciones aceptadas/pendientes para esta fecha
          const inscriptionsCount = await Inscription.countDocuments({
            activityId: activity._id,
            fecha: { $gte: fechaStart, $lte: fechaEnd },
            estado: { $in: ['pendiente', 'aceptada'] }
          });

          const cuposDisponibles = activity.cupo 
            ? Math.max(0, activity.cupo - inscriptionsCount)
            : null;

          // Obtener estado de inscripción del usuario para esta fecha
          const userInscriptionStatus = inscriptionMap.get(fechaStr) || null;

          return {
            fecha: occ.fecha,
            fechaStr: fechaStr,
            hora: occ.hora,
            cuposDisponibles: cuposDisponibles,
            tieneCupo: cuposDisponibles === null || cuposDisponibles > 0,
            estadoInscripcion: userInscriptionStatus // 'pendiente', 'aceptada', 'en_espera', o null
          };
        })
      );
    } else {
      // Para actividades únicas, solo devolver la fecha de la actividad
      if (activity.fecha) {
        // Normalizar fecha usando UTC para evitar problemas de zona horaria
        const fechaDate = new Date(activity.fecha);
        const year = fechaDate.getUTCFullYear();
        const month = String(fechaDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(fechaDate.getUTCDate()).padStart(2, '0');
        const fechaStr = `${year}-${month}-${day}`;
        
        const fechaStart = new Date(activity.fecha);
        fechaStart.setUTCHours(0, 0, 0, 0);
        const fechaEnd = new Date(activity.fecha);
        fechaEnd.setUTCHours(23, 59, 59, 999);

        const inscriptionsCount = await Inscription.countDocuments({
          activityId: activity._id,
          fecha: { $gte: fechaStart, $lte: fechaEnd },
          estado: { $in: ['pendiente', 'aceptada'] }
        });

        const cuposDisponibles = activity.cupo 
          ? Math.max(0, activity.cupo - inscriptionsCount)
          : null;

        const userInscriptionStatus = inscriptionMap.get(fechaStr) || null;

        availableDates = [{
          fecha: activity.fecha,
          fechaStr: fechaStr,
          hora: activity.hora || '',
          cuposDisponibles: cuposDisponibles,
          tieneCupo: cuposDisponibles === null || cuposDisponibles > 0,
          estadoInscripcion: userInscriptionStatus
        }];
      }
    }

    res.json({ availableDates });
  } catch (error) {
    console.error('Error al obtener fechas disponibles:', error);
    res.status(500).json({ message: 'Error al obtener fechas disponibles', error: error.message });
  }
};

export const createInscription = async (req, res) => {
  try {
    const { activityId, fecha, notas } = req.body;
    const userId = req.user._id;

    // Verificar que la actividad existe
    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ message: 'Actividad no encontrada' });
    }

    // Verificar que la actividad está publicada
    if (activity.estado !== 'publicada') {
      return res.status(400).json({ message: 'La actividad no está disponible para inscripción' });
    }

    const accessDenied = participantActivityAccessDenied(req, activity);
    if (accessDenied) {
      return res.status(accessDenied.status).json(accessDenied.body);
    }

    const paid = isPaidActivity(activity);
    if (paid && !req.file) {
      return res.status(400).json({ message: 'Debes subir un comprobante de transferencia' });
    }

    // Validar fecha
    if (!fecha) {
      return res.status(400).json({ message: 'La fecha es requerida' });
    }

    // Normalizar fecha usando UTC para evitar problemas de zona horaria
    // Si fecha viene como string "YYYY-MM-DD", crear Date en UTC
    const fechaInscripcion = new Date(fecha + 'T00:00:00.000Z');
    const fechaEnd = new Date(fecha + 'T23:59:59.999Z');

    // Determinar hora según tipo de actividad
    let hora = activity.hora || '';
    if (activity.tipo === 'recurrente' && activity.recurrence) {
      hora = activity.recurrence.hora || activity.hora || '';
    }

    let pagoData = null;
    if (paid) {
      pagoData = await buildPagoFromFile(req.file, activity);
    }

    // Verificar si ya está inscrito en esta fecha
    const existingInscription = await Inscription.findOne({ 
      userId, 
      activityId,
      fecha: { $gte: fechaInscripcion, $lte: fechaEnd }
    });
    
    if (existingInscription) {
      if (existingInscription.estado === 'cancelada') {
        const cupoFull = await isCupoFull(activity, fechaInscripcion, fechaEnd);
        const nuevoEstado = determineInitialEstado(activity, cupoFull);
        existingInscription.estado = nuevoEstado;
        existingInscription.fechaInscripcion = new Date();
        existingInscription.fechaCancelacion = null;
        existingInscription.fechaAprobacion = nuevoEstado === 'aceptada' ? new Date() : null;
        existingInscription.fecha = fechaInscripcion;
        existingInscription.hora = hora;
        if (notas) existingInscription.notas = notas;
        if (paid) {
          existingInscription.pago = pagoData;
        } else {
          existingInscription.pago = undefined;
        }
        await existingInscription.save();
        
        return res.json({
          message: paid ? paidInscriptionMessage(nuevoEstado) : freeInscriptionMessage(activity, nuevoEstado),
          inscription: existingInscription
        });
      }
      return res.status(400).json({ message: 'Ya estás inscrito en esta fecha' });
    }

    // Verificar cupo
    const cupoFull = await isCupoFull(activity, fechaInscripcion, fechaEnd);
    if (cupoFull && activity.cupo) {
      const estadoInicial = 'en_espera';
      const inscription = new Inscription({
        userId,
        activityId,
        fecha: fechaInscripcion,
        hora: hora,
        estado: estadoInicial,
        notas,
        ...(paid ? { pago: pagoData } : {})
      });
      await inscription.save();
      return res.json({
        message: paid ? paidInscriptionMessage(estadoInicial) : freeInscriptionMessage(activity, estadoInicial),
        inscription
      });
    }

    const estadoInicial = determineInitialEstado(activity, false);

    const inscription = new Inscription({
      userId,
      activityId,
      fecha: fechaInscripcion,
      hora: hora,
      estado: estadoInicial,
      notas,
      ...(paid ? { pago: pagoData } : {})
    });

    if (estadoInicial === 'aceptada') {
      inscription.fechaAprobacion = new Date();
    }

    await inscription.save();

    res.status(201).json({
      message: paid ? paidInscriptionMessage(estadoInicial) : freeInscriptionMessage(activity, estadoInicial),
      inscription
    });
  } catch (error) {
    console.error('Error al crear inscripción:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Ya estás inscrito en esta fecha' });
    }
    res.status(500).json({ message: 'Error al crear inscripción', error: error.message });
  }
};

async function isCupoFull(activity, fechaInscripcion, fechaEnd) {
  if (!activity.cupo) return false;
  const inscriptionsCount = await Inscription.countDocuments({
    activityId: activity._id,
    fecha: { $gte: fechaInscripcion, $lte: fechaEnd },
    estado: { $in: ['pendiente', 'aceptada'] }
  });
  return inscriptionsCount >= activity.cupo;
}

export const getMyInscriptions = async (req, res) => {
  try {
    const { estado } = req.query;
    const query = { userId: req.user._id };
    
    if (estado) {
      query.estado = estado;
    }

    const inscriptions = await Inscription.find(query)
      .populate('activityId', 'titulo descripcion fecha hora lugar precio esGratuita fotos categorias tipo')
      .sort({ fechaInscripcion: -1 });

    res.json({ inscriptions, count: inscriptions.length });
  } catch (error) {
    console.error('Error al obtener inscripciones:', error);
    res.status(500).json({ message: 'Error al obtener inscripciones', error: error.message });
  }
};

export const cancelInscription = async (req, res) => {
  try {
    const inscription = await Inscription.findById(req.params.id);
    
    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }

    // Verificar que pertenece al usuario
    if (inscription.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No tienes permisos para cancelar esta inscripción' });
    }

    inscription.estado = 'cancelada';
    inscription.fechaCancelacion = new Date();
    await inscription.save();

    res.json({
      message: 'Inscripción cancelada exitosamente',
      inscription
    });
  } catch (error) {
    console.error('Error al cancelar inscripción:', error);
    res.status(500).json({ message: 'Error al cancelar inscripción', error: error.message });
  }
};

/** Inscripciones aceptadas cuya aceptación (fechaAprobacion o, en legado, fechaInscripcion) ocurrió en los últimos 30 días. */
export const countAcceptedInscriptionsLast30Days = async (req, res) => {
  try {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    since.setUTCHours(0, 0, 0, 0);

    const count = await Inscription.countDocuments({
      estado: 'aceptada',
      $expr: {
        $gte: [{ $ifNull: ['$fechaAprobacion', '$fechaInscripcion'] }, since]
      }
    });

    res.json({ count });
  } catch (error) {
    console.error('Error al contar inscripciones aceptadas recientes:', error);
    res.status(500).json({ message: 'Error al obtener estadística', error: error.message });
  }
};

export const getPendingPaymentInscriptions = async (req, res) => {
  try {
    const inscriptions = await Inscription.find({
      'pago.estadoPago': 'pendiente',
      'pago.comprobante.url': { $exists: true, $ne: '' }
    })
      .populate('userId', 'nombre apellido email telefono')
      .populate('activityId', 'titulo fecha hora precio esGratuita tipo')
      .sort({ fechaInscripcion: -1 });

    res.json({ inscriptions, count: inscriptions.length });
  } catch (error) {
    console.error('Error al obtener comprobantes pendientes:', error);
    res.status(500).json({ message: 'Error al obtener comprobantes pendientes', error: error.message });
  }
};

export const getAllInscriptions = async (req, res) => {
  try {
    const { estado, activityId, fecha, userId } = req.query;

    const query = {};
    if (estado) {
      query.estado = estado;
    }
    if (activityId) {
      query.activityId = activityId;
    }
    if (userId) {
      query.userId = userId;
    }
    if (fecha) {
      const fechaStart = new Date(fecha);
      fechaStart.setHours(0, 0, 0, 0);
      const fechaEnd = new Date(fecha);
      fechaEnd.setHours(23, 59, 59, 999);
      query.fecha = { $gte: fechaStart, $lte: fechaEnd };
    }

    const inscriptions = await Inscription.find(query)
      .populate('userId', 'nombre apellido email telefono tags')
      .populate('activityId', 'titulo descripcion fecha hora lugar tipo')
      .sort({ fechaInscripcion: -1 });

    res.json({ inscriptions, count: inscriptions.length });
  } catch (error) {
    console.error('Error al obtener inscripciones:', error);
    res.status(500).json({ message: 'Error al obtener inscripciones', error: error.message });
  }
};

export const getActivityInscriptions = async (req, res) => {
  try {
    const { activityId } = req.params;
    const { estado, fecha } = req.query;

    const query = { activityId };
    if (estado) {
      query.estado = estado;
    }
    if (fecha) {
      const fechaStart = new Date(fecha);
      fechaStart.setHours(0, 0, 0, 0);
      const fechaEnd = new Date(fecha);
      fechaEnd.setHours(23, 59, 59, 999);
      query.fecha = { $gte: fechaStart, $lte: fechaEnd };
    }

    const inscriptions = await Inscription.find(query)
      .populate('userId', 'nombre apellido email telefono tags')
      .sort({ fechaInscripcion: -1 });

    res.json({ inscriptions, count: inscriptions.length });
  } catch (error) {
    console.error('Error al obtener inscripciones de actividad:', error);
    res.status(500).json({ message: 'Error al obtener inscripciones', error: error.message });
  }
};

export const approveInscription = async (req, res) => {
  try {
    const inscription = await Inscription.findById(req.params.id);
    
    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }

    // Verificar cupo antes de aprobar
    const activity = await Activity.findById(inscription.activityId);
    if (activity && activity.cupo) {
      const fechaStart = new Date(inscription.fecha);
      fechaStart.setHours(0, 0, 0, 0);
      const fechaEnd = new Date(inscription.fecha);
      fechaEnd.setHours(23, 59, 59, 999);

      const inscriptionsCount = await Inscription.countDocuments({
        activityId: inscription.activityId,
        fecha: { $gte: fechaStart, $lte: fechaEnd },
        estado: { $in: ['pendiente', 'aceptada'] },
        _id: { $ne: inscription._id } // Excluir la inscripción actual
      });

      if (inscriptionsCount >= activity.cupo) {
        return res.status(400).json({ message: 'No hay cupo disponible para esta fecha' });
      }
    }

    inscription.estado = 'aceptada';
    inscription.fechaAprobacion = new Date();
    await inscription.save();

    res.json({
      message: 'Inscripción aprobada exitosamente',
      inscription
    });
  } catch (error) {
    console.error('Error al aprobar inscripción:', error);
    res.status(500).json({ message: 'Error al aprobar inscripción', error: error.message });
  }
};

export const rejectInscription = async (req, res) => {
  try {
    const inscription = await Inscription.findById(req.params.id);
    
    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }

    inscription.estado = 'cancelada';
    inscription.fechaCancelacion = new Date();
    await inscription.save();

    res.json({
      message: 'Inscripción rechazada',
      inscription
    });
  } catch (error) {
    console.error('Error al rechazar inscripción:', error);
    res.status(500).json({ message: 'Error al rechazar inscripción', error: error.message });
  }
};

export const updateInscriptionStatus = async (req, res) => {
  try {
    const { estado } = req.body;
    const { id } = req.params;

    // Validar estado
    const validStates = ['pendiente', 'aceptada', 'cancelada', 'en_espera'];
    if (!validStates.includes(estado)) {
      return res.status(400).json({ message: 'Estado inválido' });
    }

    const inscription = await Inscription.findById(id);
    
    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }

    // Si se está aprobando, verificar cupo
    if (estado === 'aceptada' && inscription.estado !== 'aceptada') {
      const activity = await Activity.findById(inscription.activityId);
      if (activity && activity.cupo) {
        const fechaStart = new Date(inscription.fecha);
        fechaStart.setUTCHours(0, 0, 0, 0);
        const fechaEnd = new Date(inscription.fecha);
        fechaEnd.setUTCHours(23, 59, 59, 999);

        const inscriptionsCount = await Inscription.countDocuments({
          activityId: inscription.activityId,
          fecha: { $gte: fechaStart, $lte: fechaEnd },
          estado: { $in: ['pendiente', 'aceptada'] },
          _id: { $ne: inscription._id }
        });

        if (inscriptionsCount >= activity.cupo) {
          return res.status(400).json({ message: 'No hay cupo disponible para esta fecha' });
        }
      }
      inscription.fechaAprobacion = new Date();
    }

    // Actualizar estado y fechas relacionadas
    inscription.estado = estado;
    
    if (estado === 'cancelada' && !inscription.fechaCancelacion) {
      inscription.fechaCancelacion = new Date();
    }
    
    if (estado !== 'aceptada') {
      inscription.fechaAprobacion = null;
    }

    await inscription.save();

    res.json({
      message: `Estado actualizado a ${estado}`,
      inscription
    });
  } catch (error) {
    console.error('Error al actualizar estado de inscripción:', error);
    res.status(500).json({ message: 'Error al actualizar estado', error: error.message });
  }
};

export const approvePayment = async (req, res) => {
  try {
    const inscription = await Inscription.findById(req.params.id);

    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }

    if (!inscription.pago?.comprobante?.url) {
      return res.status(400).json({ message: 'Esta inscripción no tiene comprobante de pago' });
    }

    if (inscription.pago.estadoPago === 'aprobado') {
      return res.status(400).json({ message: 'El pago ya fue aprobado' });
    }

    const activity = await Activity.findById(inscription.activityId);
    if (activity && activity.cupo) {
      const fechaStart = new Date(inscription.fecha);
      fechaStart.setHours(0, 0, 0, 0);
      const fechaEnd = new Date(inscription.fecha);
      fechaEnd.setHours(23, 59, 59, 999);

      const inscriptionsCount = await Inscription.countDocuments({
        activityId: inscription.activityId,
        fecha: { $gte: fechaStart, $lte: fechaEnd },
        estado: { $in: ['pendiente', 'aceptada'] },
        _id: { $ne: inscription._id }
      });

      if (inscriptionsCount >= activity.cupo) {
        return res.status(400).json({ message: 'No hay cupo disponible para esta fecha' });
      }
    }

    inscription.pago.estadoPago = 'aprobado';
    inscription.pago.fechaRevision = new Date();
    inscription.pago.revisadoPor = req.user._id;
    inscription.pago.motivoRechazo = undefined;
    inscription.estado = 'aceptada';
    inscription.fechaAprobacion = new Date();
    await inscription.save();

    res.json({
      message: 'Comprobante aprobado. Inscripción confirmada.',
      inscription
    });
  } catch (error) {
    console.error('Error al aprobar pago:', error);
    res.status(500).json({ message: 'Error al aprobar pago', error: error.message });
  }
};

export const rejectPayment = async (req, res) => {
  try {
    const { motivoRechazo } = req.body;
    const inscription = await Inscription.findById(req.params.id);

    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }

    if (!inscription.pago?.comprobante?.url) {
      return res.status(400).json({ message: 'Esta inscripción no tiene comprobante de pago' });
    }

    inscription.pago.estadoPago = 'rechazado';
    inscription.pago.fechaRevision = new Date();
    inscription.pago.revisadoPor = req.user._id;
    inscription.pago.motivoRechazo = motivoRechazo?.trim() || '';
    inscription.estado = 'pendiente';
    inscription.fechaAprobacion = null;
    await inscription.save();

    res.json({
      message: 'Comprobante rechazado. El participante puede volver a subir uno nuevo.',
      inscription
    });
  } catch (error) {
    console.error('Error al rechazar pago:', error);
    res.status(500).json({ message: 'Error al rechazar pago', error: error.message });
  }
};

export const updateComprobante = async (req, res) => {
  try {
    const inscription = await Inscription.findById(req.params.id);

    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }

    if (inscription.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No tienes permisos para actualizar este comprobante' });
    }

    if (!inscription.pago) {
      return res.status(400).json({ message: 'Esta inscripción no requiere comprobante de pago' });
    }

    if (!['pendiente', 'rechazado'].includes(inscription.pago.estadoPago)) {
      return res.status(400).json({ message: 'No puedes actualizar el comprobante en este estado' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Debes subir un comprobante de transferencia' });
    }

    const activity = await Activity.findById(inscription.activityId);
    if (!activity) {
      return res.status(404).json({ message: 'Actividad no encontrada' });
    }

    const pagoData = await buildPagoFromFile(req.file, activity);
    inscription.pago = {
      ...pagoData,
      motivoRechazo: undefined,
      fechaRevision: undefined,
      revisadoPor: undefined,
    };
    inscription.estado = 'pendiente';
    inscription.fechaAprobacion = null;
    await inscription.save();

    res.json({
      message: 'Comprobante actualizado. Queda pendiente de revisión.',
      inscription
    });
  } catch (error) {
    console.error('Error al actualizar comprobante:', error);
    res.status(500).json({ message: 'Error al actualizar comprobante', error: error.message });
  }
};

export const getComprobanteFile = async (req, res) => {
  try {
    const inscription = await Inscription.findById(req.params.id);

    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }

    const fileUrl = inscription.pago?.comprobante?.url;
    if (!fileUrl) {
      return res.status(404).json({ message: 'Esta inscripción no tiene comprobante de pago' });
    }

    const upstream = await fetch(fileUrl);
    if (!upstream.ok) {
      return res.status(502).json({ message: 'No se pudo obtener el comprobante' });
    }

    const contentType = upstream.headers.get('content-type') || 'application/pdf';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error('Error al obtener comprobante:', error);
    res.status(500).json({ message: 'Error al obtener comprobante', error: error.message });
  }
};

export const getUserActivityInscriptions = async (req, res) => {
  try {
    const { activityId } = req.params;
    const userId = req.user._id;

    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ message: 'Actividad no encontrada' });
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const inscriptions = await Inscription.find({
      userId: userId,
      activityId: activity._id,
      fecha: { $gte: now },
      estado: { $in: ['pendiente', 'aceptada', 'en_espera'] }
    })
    .populate('activityId', 'titulo descripcion fecha hora lugar precio fotos categorias tipo')
    .sort({ fecha: 1 });

    res.json({
      inscriptions,
      count: inscriptions.length
    });
  } catch (error) {
    console.error('Error al obtener inscripciones del usuario:', error);
    res.status(500).json({
      message: 'Error al obtener inscripciones del usuario',
      error: error.message
    });
  }
};

