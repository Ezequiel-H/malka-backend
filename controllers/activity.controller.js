import Activity from '../models/Activity.model.js';
import Inscription from '../models/Inscription.model.js';
import User from '../models/User.model.js';
import { validationResult } from 'express-validator';
import ExcelJS from 'exceljs';
import { calculateNextOccurrence, calculateOccurrences } from '../utils/generateOccurrences.js';

export const createActivity = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const activityData = {
      ...req.body,
      organizadorId: req.user._id
    };

    const activity = new Activity(activityData);
    await activity.save();

    res.status(201).json({
      message: 'Actividad creada exitosamente',
      activity
    });
  } catch (error) {
    console.error('Error al crear actividad:', error);
    res.status(500).json({ message: 'Error al crear actividad', error: error.message });
  }
};

export const getActivities = async (req, res) => {
  try {
    const {
      estado,
      categoria,
      fechaDesde,
      fechaHasta,
      tipo,
      requiereAprobacion,
      precioMin,
      precioMax,
      tieneCupo,
      tagsVisibilidad,
      search
    } = req.query;

    const query = {};

    // Solo usuarios aprobados pueden ver actividades publicadas
    if (req.user.role === 'participant' && req.user.estado !== 'approved') {
      return res.status(403).json({ message: 'Tu cuenta debe estar aprobada para ver actividades' });
    }

    // Si es participante, solo ver publicadas
    if (req.user.role === 'participant') {
      query.estado = 'publicada';
    } else if (estado) {
      query.estado = estado;
    }

    // Filtro por categoría
    if (categoria) {
      query.categorias = { $in: [categoria] };
    }

    // Filtro por tipo
    if (tipo) {
      query.tipo = tipo;
    }

    // Filtro por requiere aprobación
    if (requiereAprobacion !== undefined) {
      query.requiereAprobacion = requiereAprobacion === 'true';
    }

    // Filtro por precio
    if (precioMin || precioMax) {
      query.precio = {};
      if (precioMin) query.precio.$gte = Number(precioMin);
      if (precioMax) query.precio.$lte = Number(precioMax);
    }

    // Filtro por fecha - se aplicará después para incluir actividades recurrentes
    // Normalizar fechas: fechaDesde al inicio del día, fechaHasta al final del día
    let fechaDesdeFilter = null;
    let fechaHastaFilter = null;
    
    if (fechaDesde) {
      fechaDesdeFilter = new Date(fechaDesde);
      fechaDesdeFilter.setHours(0, 0, 0, 0);
    }
    
    if (fechaHasta) {
      fechaHastaFilter = new Date(fechaHasta);
      fechaHastaFilter.setHours(23, 59, 59, 999);
    }
    
    // Para actividades únicas, aplicar filtro de fecha directamente en el query
    // Para actividades recurrentes, se filtrará por próxima ocurrencia después
    if (fechaDesdeFilter || fechaHastaFilter) {
      if (tipo === 'unica') {
        // Solo actividades únicas: filtrar por fecha en el query
        query.fecha = {};
        if (fechaDesdeFilter) query.fecha.$gte = fechaDesdeFilter;
        if (fechaHastaFilter) query.fecha.$lte = fechaHastaFilter;
      }
      // Si tipo === 'recurrente' o no hay tipo, no aplicar filtro aquí, se hará después
    }

    // Búsqueda por texto
    if (search) {
      query.$or = [
        { titulo: { $regex: search, $options: 'i' } },
        { descripcion: { $regex: search, $options: 'i' } }
      ];
    }

    let activities = await Activity.find(query)
      .populate('organizadorId', 'nombre apellido email')
      .sort({ fecha: 1, createdAt: -1 });

    // Calcular próxima ocurrencia para actividades recurrentes y aplicar filtro de fecha
    activities = await Promise.all(
      activities.map(async (activity) => {
        let nextOccurrence = null;
        
        if (activity.tipo === 'recurrente') {
          // Calcular la próxima ocurrencia sobre la marcha
          const startDate = fechaDesdeFilter && fechaDesdeFilter > new Date()
            ? fechaDesdeFilter
            : (activity.fecha && new Date(activity.fecha) > new Date() 
              ? activity.fecha 
              : new Date());
          
          nextOccurrence = calculateNextOccurrence(activity, startDate);
          
          // Si hay filtro de fecha, verificar que la próxima ocurrencia esté en el rango
          if (fechaDesdeFilter || fechaHastaFilter) {
            if (!nextOccurrence) {
              return null;
            }
            
            const nextDate = new Date(nextOccurrence);
            nextDate.setHours(0, 0, 0, 0);
            
            let inRange = true;
            if (fechaDesdeFilter && nextDate < fechaDesdeFilter) {
              inRange = false;
            }
            if (fechaHastaFilter) {
              const fechaHastaStart = new Date(fechaHastaFilter);
              fechaHastaStart.setHours(0, 0, 0, 0);
              if (nextDate > fechaHastaStart) {
                inRange = false;
              }
            }
            
            if (!inRange) {
              return null;
            }
          }
        }
        
        return {
          ...activity.toObject(),
          proximaOcurrencia: nextOccurrence
        };
      })
    );
    
    // Filtrar actividades nulas (excluidas por filtros)
    activities = activities.filter(a => a !== null);

    // Filtro de visibilidad por tags (para participantes) - aplicar después de obtener actividades
    if (req.user.role === 'participant') {
      const userTags = (req.user.tags || []).map(tag => tag.toLowerCase());
      activities = activities.filter(activity => {
        // Actividades públicas siempre se muestran
        if (activity.visibilidad === 'publica') {
          return true;
        }
        // Actividades privadas solo si el usuario tiene al menos una tag requerida
        if (activity.visibilidad === 'privada') {
          if (!activity.tagsVisibilidad || activity.tagsVisibilidad.length === 0) {
            return false; // Si es privada pero no tiene tags, no se muestra
          }
          const activityTagsLower = (activity.tagsVisibilidad || []).map(tag => tag.toLowerCase());
          return activityTagsLower.some(tag => userTags.includes(tag));
        }
        return true; // Por defecto, mostrar (por si acaso hay un valor inesperado)
      });
    }

    // Filtro de cupo (post-query para calcular disponibilidad)
    if (tieneCupo === 'true') {
      activities = await Promise.all(
        activities.map(async (activity) => {
          if (!activity.cupo) return activity;
          const inscriptionsCount = await Inscription.countDocuments({
            activityId: activity._id,
            estado: { $in: ['pendiente', 'aceptada'] }
          });
          return inscriptionsCount < activity.cupo ? activity : null;
        })
      );
      activities = activities.filter(a => a !== null);
    }

    res.json({ activities, count: activities.length });
  } catch (error) {
    console.error('Error al obtener actividades:', error);
    res.status(500).json({ message: 'Error al obtener actividades', error: error.message });
  }
};

export const getActivityById = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id)
      .populate('organizadorId', 'nombre apellido email');

    if (!activity) {
      return res.status(404).json({ message: 'Actividad no encontrada' });
    }

    // Verificar visibilidad para participantes
    if (req.user.role === 'participant') {
      if (activity.estado !== 'publicada') {
        return res.status(404).json({ message: 'Actividad no encontrada' });
      }
      // Si la actividad es privada, verificar que el usuario tenga las tags requeridas
      if (activity.visibilidad === 'privada') {
        if (!activity.tagsVisibilidad || activity.tagsVisibilidad.length === 0) {
          // Si es privada pero no tiene tags, no se muestra a nadie
          return res.status(403).json({ message: 'No tienes acceso a esta actividad' });
        }
        const userTags = (req.user.tags || []).map(tag => tag.toLowerCase());
        const activityTagsLower = (activity.tagsVisibilidad || []).map(tag => tag.toLowerCase());
        const hasRequiredTag = activityTagsLower.some(tag => userTags.includes(tag));
        if (!hasRequiredTag) {
          return res.status(403).json({ message: 'No tienes acceso a esta actividad' });
        }
      }
      // Si es pública, se permite el acceso sin verificar tags
    }

    // Calcular cupos disponibles
    let cuposDisponibles = null;
    let cuposOcupados = 0;

    if (activity.cupo) {
      const totalInscriptions = await Inscription.countDocuments({
        activityId: activity._id,
        estado: { $in: ['pendiente', 'aceptada'] }
      });
      cuposOcupados = totalInscriptions;
      cuposDisponibles = Math.max(0, activity.cupo - totalInscriptions);
    }

    res.json({
      activity: {
        ...activity.toObject(),
        cuposDisponibles,
        cuposOcupados
      }
    });
  } catch (error) {
    console.error('Error al obtener actividad:', error);
    res.status(500).json({ message: 'Error al obtener actividad', error: error.message });
  }
};

export const updateActivity = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const activity = await Activity.findById(req.params.id);
    if (!activity) {
      return res.status(404).json({ message: 'Actividad no encontrada' });
    }

    // Verificar que el usuario es el organizador o admin
    if (activity.organizadorId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'No tienes permisos para editar esta actividad' });
    }

    Object.assign(activity, req.body);
    await activity.save();

    res.json({
      message: 'Actividad actualizada exitosamente',
      activity
    });
  } catch (error) {
    console.error('Error al actualizar actividad:', error);
    res.status(500).json({ message: 'Error al actualizar actividad', error: error.message });
  }
};

export const deleteActivity = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) {
      return res.status(404).json({ message: 'Actividad no encontrada' });
    }

    // Soft delete: cambiar estado a eliminada
    activity.estado = 'eliminada';
    await activity.save();

    res.json({ message: 'Actividad eliminada exitosamente' });
  } catch (error) {
    console.error('Error al eliminar actividad:', error);
    res.status(500).json({ message: 'Error al eliminar actividad', error: error.message });
  }
};


export const exportInscriptionsToExcel = async (req, res) => {
  try {
    const activityId = req.params.id;
    const activity = await Activity.findById(activityId);
    
    if (!activity) {
      return res.status(404).json({ message: 'Actividad no encontrada' });
    }

    const inscriptions = await Inscription.find({ activityId })
      .populate('userId', 'nombre apellido email telefono tags')
      .sort({ fechaInscripcion: -1 });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inscriptos');

    // Define columns
    worksheet.columns = [
      { header: 'Nombre', key: 'nombre', width: 20 },
      { header: 'Apellido', key: 'apellido', width: 20 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Teléfono', key: 'telefono', width: 15 },
      { header: 'Estado', key: 'estado', width: 15 },
      { header: 'Fecha Inscripción', key: 'fechaInscripcion', width: 20 },
      { header: 'Fecha Aprobación', key: 'fechaAprobacion', width: 20 },
      { header: 'Fecha Cancelación', key: 'fechaCancelacion', width: 20 },
      { header: 'Tags', key: 'tags', width: 30 },
      { header: 'Notas', key: 'notas', width: 40 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    inscriptions.forEach(inscription => {
      const user = inscription.userId;
      worksheet.addRow({
        nombre: user.nombre || '',
        apellido: user.apellido || '',
        email: user.email || '',
        telefono: user.telefono || '',
        estado: inscription.estado,
        fechaInscripcion: inscription.fechaInscripcion ? inscription.fechaInscripcion.toLocaleDateString('es-AR') : '',
        fechaAprobacion: inscription.fechaAprobacion ? inscription.fechaAprobacion.toLocaleDateString('es-AR') : '',
        fechaCancelacion: inscription.fechaCancelacion ? inscription.fechaCancelacion.toLocaleDateString('es-AR') : '',
        tags: (user.tags || []).join(', '),
        notas: inscription.notas || ''
      });
    });

    // Set response headers
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=inscriptos-${activity.titulo.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.xlsx`
    );

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error al exportar inscripciones:', error);
    res.status(500).json({ message: 'Error al exportar inscripciones', error: error.message });
  }
};

