import Inscription from '../models/Inscription.model.js';
import Activity from '../models/Activity.model.js';
import User from '../models/User.model.js';
import { calculateOccurrences } from '../utils/generateOccurrences.js';

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

    // Verificar visibilidad por tags
    if (activity.tagsVisibilidad && activity.tagsVisibilidad.length > 0) {
      const userTags = req.user.tags || [];
      const hasRequiredTag = activity.tagsVisibilidad.some(tag => userTags.includes(tag));
      if (!hasRequiredTag) {
        return res.status(403).json({ message: 'No tienes acceso a esta actividad' });
      }
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

    // Verificar si ya está inscrito en esta fecha
    const existingInscription = await Inscription.findOne({ 
      userId, 
      activityId,
      fecha: { $gte: fechaInscripcion, $lte: fechaEnd }
    });
    
    if (existingInscription) {
      if (existingInscription.estado === 'cancelada') {
        // Permitir re-inscripción si estaba cancelada
        existingInscription.estado = activity.requiereAprobacion ? 'pendiente' : 'aceptada';
        existingInscription.fechaInscripcion = new Date();
        existingInscription.fechaCancelacion = null;
        existingInscription.fecha = fechaInscripcion;
        existingInscription.hora = hora;
        if (notas) existingInscription.notas = notas;
        await existingInscription.save();
        
        return res.json({
          message: activity.requiereAprobacion 
            ? 'Inscripción realizada. Pendiente de aprobación.' 
            : 'Inscripción realizada exitosamente',
          inscription: existingInscription
        });
      }
      return res.status(400).json({ message: 'Ya estás inscrito en esta fecha' });
    }

    // Verificar cupo
    if (activity.cupo) {
      const inscriptionsCount = await Inscription.countDocuments({
        activityId: activity._id,
        fecha: { $gte: fechaInscripcion, $lte: fechaEnd },
        estado: { $in: ['pendiente', 'aceptada'] }
      });

      if (inscriptionsCount >= activity.cupo) {
        // Crear inscripción en lista de espera
        const inscription = new Inscription({
          userId,
          activityId,
          fecha: fechaInscripcion,
          hora: hora,
          estado: 'en_espera',
          notas
        });
        await inscription.save();
        return res.json({
          message: 'Cupo completo. Has sido agregado a la lista de espera.',
          inscription
        });
      }
    }

    // Determinar estado inicial según tipo de inscripción
    const estadoInicial = activity.requiereAprobacion ? 'pendiente' : 'aceptada';

    const inscription = new Inscription({
      userId,
      activityId,
      fecha: fechaInscripcion,
      hora: hora,
      estado: estadoInicial,
      notas
    });

    if (estadoInicial === 'aceptada') {
      inscription.fechaAprobacion = new Date();
    }

    await inscription.save();

    res.status(201).json({
      message: activity.requiereAprobacion 
        ? 'Inscripción realizada. Pendiente de aprobación.' 
        : 'Inscripción realizada exitosamente',
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

export const getMyInscriptions = async (req, res) => {
  try {
    const { estado } = req.query;
    const query = { userId: req.user._id };
    
    if (estado) {
      query.estado = estado;
    }

    const inscriptions = await Inscription.find(query)
      .populate('activityId', 'titulo descripcion fecha hora lugar precio fotos categorias tipo')
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

/**
 * Obtiene las inscripciones futuras del usuario para una actividad específica
 */
export const getUserActivityInscriptions = async (req, res) => {
  try {
    const { activityId } = req.params;
    const userId = req.user._id;

    // Verificar que la actividad existe
    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ message: 'Actividad no encontrada' });
    }

    // Obtener inscripciones futuras del usuario para esta actividad
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const inscriptions = await Inscription.find({
      userId: userId,
      activityId: activity._id,
      fecha: { $gte: now },
      estado: { $in: ['pendiente', 'aceptada', 'en_espera'] }
    })
    .populate('activityId', 'titulo descripcion fecha hora lugar precio fotos categorias tipo')
    .sort({ fecha: 1 }); // Ordenar por fecha ascendente

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
