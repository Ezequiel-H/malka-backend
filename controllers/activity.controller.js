import Activity from '../models/Activity.model.js';
import Inscription from '../models/Inscription.model.js';
import User from '../models/User.model.js';
import { participantCanViewActivity, participantActivityAccessDenied } from '../utils/participantActivityAccess.js';
import { validationResult } from 'express-validator';
import ExcelJS from 'exceljs';
import { calculateNextOccurrence, calculateOccurrences } from '../utils/generateOccurrences.js';

// Helper function to convert date string (YYYY-MM-DD) to Date object
// Simple conversion: just use the year, month, day as-is, no timezone conversion
const parseSimpleDate = (dateString) => {
  if (!dateString) return null;
  
  // If it's already a Date object, extract the date components and create a new UTC date
  if (dateString instanceof Date) {
    // Get the date components (year, month, day) as simple numbers
    const year = dateString.getFullYear();
    const month = dateString.getMonth();
    const day = dateString.getDate();
    // Create UTC date with these exact values - no timezone conversion
    return new Date(Date.UTC(year, month, day, 12, 0, 0, 0)); // Use noon UTC to avoid day shift
  }
  
  // If it's a string in YYYY-MM-DD format, parse it directly
  if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-').map(Number);
    // Create UTC date with these exact values - no timezone conversion
    // Use noon UTC (12:00) to avoid any day shift issues
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  }
  
  // Otherwise, try to parse it normally
  return new Date(dateString);
};

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

    // Parse dates as simple dates (no timezone conversion)
    if (activityData.fecha) {
      activityData.fecha = parseSimpleDate(activityData.fecha);
    }
    if (activityData.recurrence?.endDate) {
      activityData.recurrence.endDate = parseSimpleDate(activityData.recurrence.endDate);
    }

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
    
    // Para participantes, filtrar actividades desde ayer en adelante por defecto
    if (req.user.role === 'participant' && !fechaDesde) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      fechaDesdeFilter = yesterday;
    }
    
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
    // (no filtramos recurrentes por fecha en el query porque fecha es la fecha de inicio de la recurrencia)
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
          // Si hay un rango de fechas, buscar ocurrencias dentro de ese rango específico
          if (fechaDesdeFilter || fechaHastaFilter) {
            // Normalizar las fechas del rango
            const fechaDesdeDate = fechaDesdeFilter ? new Date(fechaDesdeFilter) : null;
            if (fechaDesdeDate) {
              fechaDesdeDate.setHours(0, 0, 0, 0);
            }
            
            const fechaHastaDate = fechaHastaFilter ? new Date(fechaHastaFilter) : null;
            if (fechaHastaDate) {
              fechaHastaDate.setHours(23, 59, 59, 999);
            }
            
            // Usar el inicio del rango como punto de partida para buscar
            // Si no hay fechaDesde, usar hoy o la fecha de inicio de la actividad
            let startDate = fechaDesdeDate || new Date();
            if (!fechaDesdeDate && activity.fecha && new Date(activity.fecha) > new Date()) {
              startDate = activity.fecha;
            }
            startDate.setHours(0, 0, 0, 0);
            
            // Buscar la primera ocurrencia dentro del rango
            let foundInRange = false;
            const maxIterations = 20; // Límite de seguridad para evitar loops infinitos
            let searchDate = startDate;
            
            for (let i = 0; i < maxIterations; i++) {
              const candidate = calculateNextOccurrence(activity, searchDate);
              if (!candidate) {
                break;
              }
              
              const candidateDate = new Date(candidate);
              candidateDate.setHours(0, 0, 0, 0);
              
              // Verificar si está dentro del rango
              let inRange = true;
              
              // Debe ser >= fechaDesde (si existe)
              if (fechaDesdeDate && candidateDate < fechaDesdeDate) {
                inRange = false;
                // Está antes del rango, seguir buscando desde esta fecha
                searchDate = candidateDate;
                searchDate.setDate(searchDate.getDate() + 1);
                continue;
              }
              
              // Debe ser <= fechaHasta (si existe)
              if (fechaHastaDate && candidateDate > fechaHastaDate) {
                // Ya pasamos el rango, no hay más ocurrencias en este rango
                break;
              }
              
              // Si llegamos aquí, está en el rango
              if (inRange) {
                nextOccurrence = candidate;
                foundInRange = true;
                break;
              }
              
              // Continuar buscando desde la siguiente fecha
              searchDate = candidateDate;
              searchDate.setDate(searchDate.getDate() + 1);
            }
            
            if (!foundInRange || !nextOccurrence) {
              return null;
            }
          } else {
            // Sin filtro de fecha, calcular la próxima ocurrencia normalmente
            let startDate = new Date();
            if (activity.fecha && new Date(activity.fecha) > new Date()) {
              startDate = activity.fecha;
            }
            nextOccurrence = calculateNextOccurrence(activity, startDate);
          }
          
          // Si no hay filtro de fecha pero es participante, aplicar filtro por defecto
          if (!fechaDesdeFilter && !fechaHastaFilter && req.user.role === 'participant') {
            // Para participantes, filtrar actividades recurrentes desde ayer en adelante
            if (!nextOccurrence) {
              return null;
            }
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(0, 0, 0, 0);
            
            const nextDate = new Date(nextOccurrence);
            nextDate.setHours(0, 0, 0, 0);
            
            if (nextDate < yesterday) {
              return null;
            }
          }
        } else if (activity.tipo === 'unica') {
          // Para actividades únicas, verificar que estén en el rango si hay filtro de fecha
          if (fechaDesdeFilter || fechaHastaFilter) {
            if (!activity.fecha) {
              // Si no tiene fecha, no mostrar
              return null;
            }
            
            const activityDate = new Date(activity.fecha);
            activityDate.setHours(0, 0, 0, 0);
            
            let inRange = true;
            if (fechaDesdeFilter) {
              const fechaDesdeDate = new Date(fechaDesdeFilter);
              fechaDesdeDate.setHours(0, 0, 0, 0);
              if (activityDate < fechaDesdeDate) {
                inRange = false;
              }
            }
            if (fechaHastaFilter) {
              const fechaHastaDate = new Date(fechaHastaFilter);
              fechaHastaDate.setHours(23, 59, 59, 999);
              if (activityDate > fechaHastaDate) {
                inRange = false;
              }
            }
            
            if (!inRange) {
              return null;
            }
          } else if (req.user.role === 'participant') {
            // Para participantes sin filtro de fecha, verificar que la fecha sea desde ayer en adelante
            if (activity.fecha) {
              const activityDate = new Date(activity.fecha);
              activityDate.setHours(0, 0, 0, 0);
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              yesterday.setHours(0, 0, 0, 0);
              
              if (activityDate < yesterday) {
                return null;
              }
            } else {
              // Si no tiene fecha, no mostrar
              return null;
            }
          }
        } else if (!activity.tipo && req.user.role === 'participant' && activity.fecha) {
          // Si el tipo no está definido pero tiene fecha, tratarla como única y filtrar
          const activityDate = new Date(activity.fecha);
          activityDate.setHours(0, 0, 0, 0);
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          yesterday.setHours(0, 0, 0, 0);
          
          if (activityDate < yesterday) {
            return null;
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

    // Participantes: tagsVisibilidad restringe siempre la vista (pública o privada); otras reglas en participantCanViewActivity
    if (req.user.role === 'participant') {
      activities = activities.filter((activity) =>
        participantCanViewActivity(req.user, activity)
      );
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

    // Agregar información de inscripción del usuario para cada actividad (solo para participantes)
    if (req.user.role === 'participant') {
      const userId = req.user._id;
      activities = await Promise.all(
        activities.map(async (activity) => {
          let estadoInscripcion = null;
          let fechaInscripcion = null;

          if (activity.tipo === 'unica') {
            // Para actividades únicas, verificar inscripción en la fecha específica
            if (activity.fecha) {
              const fechaStart = new Date(activity.fecha);
              fechaStart.setUTCHours(0, 0, 0, 0);
              const fechaEnd = new Date(activity.fecha);
              fechaEnd.setUTCHours(23, 59, 59, 999);

              const inscription = await Inscription.findOne({
                userId: userId,
                activityId: activity._id,
                fecha: { $gte: fechaStart, $lte: fechaEnd },
                estado: { $in: ['pendiente', 'aceptada', 'en_espera'] }
              });

              if (inscription) {
                estadoInscripcion = inscription.estado;
                fechaInscripcion = inscription.fecha;
              }
            }
          } else if (activity.tipo === 'recurrente') {
            // Para actividades recurrentes, verificar si hay alguna inscripción futura
            const now = new Date();
            now.setUTCHours(0, 0, 0, 0);

            const inscription = await Inscription.findOne({
              userId: userId,
              activityId: activity._id,
              fecha: { $gte: now },
              estado: { $in: ['pendiente', 'aceptada', 'en_espera'] }
            }).sort({ fecha: 1 }); // Obtener la más próxima

            if (inscription) {
              estadoInscripcion = inscription.estado;
              fechaInscripcion = inscription.fecha;
            }
          }

          return {
            ...activity,
            estadoInscripcion,
            fechaInscripcion
          };
        })
      );
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

    if (req.user.role === 'participant') {
      if (activity.estado !== 'publicada') {
        return res.status(404).json({ message: 'Actividad no encontrada' });
      }
      const denied = participantActivityAccessDenied(req, activity);
      if (denied) {
        return res.status(denied.status).json(denied.body);
      }
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

    // Parse dates as simple dates (no timezone conversion)
    const updateData = { ...req.body };
    if (updateData.fecha) {
      updateData.fecha = parseSimpleDate(updateData.fecha);
    }
    if (updateData.recurrence?.endDate) {
      updateData.recurrence.endDate = parseSimpleDate(updateData.recurrence.endDate);
    }

    Object.assign(activity, updateData);
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
      .populate('userId', 'nombre apellido email telefono tags restriccionesAlimentarias')
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
      { header: 'Restricciones Alimenticias', key: 'restriccionesAlimentarias', width: 40 },
      { header: 'Tags', key: 'tags', width: 30 }
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
        restriccionesAlimentarias: (user.restriccionesAlimentarias || []).join(', ') || '',
        tags: (user.tags || []).join(', ')
      });
    });

    // Format dates for filename
    const formatDateForFilename = (date) => {
      if (!date) return 'sin-fecha';
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const formatDateTimeForFilename = (date) => {
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
    };

    // Clean activity title for filename
    const cleanTitle = activity.titulo.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, '_');
    const eventDate = formatDateForFilename(activity.fecha);
    const exportDateTime = formatDateTimeForFilename(new Date());
    const filename = `${cleanTitle}_${eventDate}_exportado_${exportDateTime}.xlsx`;

    // Set response headers
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error al exportar inscripciones:', error);
    res.status(500).json({ message: 'Error al exportar inscripciones', error: error.message });
  }
};

