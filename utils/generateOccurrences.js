/**
 * Calcula las fechas de ocurrencias para una actividad recurrente en los próximos N días
 * @param {Object} activity - La actividad recurrente
 * @param {Number} daysAhead - Número de días hacia adelante (por defecto 30)
 * @param {Date} startDate - Fecha de inicio (opcional, por defecto hoy)
 * @returns {Array} Array de objetos { fecha: Date, hora: String }
 */
export const calculateOccurrences = (activity, daysAhead = 30, startDate = null) => {
  if (activity.tipo !== 'recurrente' || !activity.recurrence) {
    throw new Error('Solo se pueden calcular ocurrencias para actividades recurrentes');
  }

  const { recurrence } = activity;
  const occurrences = [];
  const start = startDate ? new Date(startDate) : new Date();
  start.setHours(0, 0, 0, 0);
  
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + daysAhead);
  
  const recurrenceEndDate = recurrence.endDate ? new Date(recurrence.endDate) : null;
  const finalEndDate = recurrenceEndDate && recurrenceEndDate < endDate ? recurrenceEndDate : endDate;

  // Hora de la ocurrencia
  const hora = recurrence.hora || activity.hora || '00:00';

  let currentDate = new Date(start);
  let count = 0;
  const maxOccurrences = recurrence.occurrences || 1000; // Límite por defecto

  while (count < maxOccurrences && currentDate <= finalEndDate) {
    let nextDate = null;

    switch (recurrence.frequency) {
      case 'daily':
        nextDate = new Date(currentDate);
        if (nextDate <= start) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
        break;

      case 'weekly':
        if (recurrence.daysOfWeek && recurrence.daysOfWeek.length > 0) {
          // Encontrar el próximo día de la semana válido
          const daysOfWeek = recurrence.daysOfWeek.sort((a, b) => a - b);
          let found = false;
          const isStartDate = currentDate.getTime() === start.getTime();
          
          for (const dayOfWeek of daysOfWeek) {
            const daysUntil = (dayOfWeek - currentDate.getDay() + 7) % 7;
            if (daysUntil > 0 || (daysUntil === 0 && isStartDate)) {
              nextDate = new Date(currentDate);
              nextDate.setDate(nextDate.getDate() + (daysUntil || 7));
              found = true;
              break;
            }
          }
          
          if (!found) {
            // Si no hay más días esta semana, ir al primero de la próxima semana
            const firstDay = daysOfWeek[0];
            const daysUntil = (firstDay - currentDate.getDay() + 7) % 7;
            nextDate = new Date(currentDate);
            nextDate.setDate(nextDate.getDate() + (daysUntil || 7));
          }
        } else if (recurrence.dayOfWeek !== undefined) {
          // Compatibilidad con el formato antiguo
          const daysUntil = (recurrence.dayOfWeek - currentDate.getDay() + 7) % 7;
          nextDate = new Date(currentDate);
          nextDate.setDate(nextDate.getDate() + (daysUntil || 7));
        }
        break;

      case 'monthly':
        if (recurrence.dayOfMonth && recurrence.dayOfMonth.length > 0) {
          const daysOfMonth = recurrence.dayOfMonth.sort((a, b) => a - b);
          let found = false;
          
          for (const day of daysOfMonth) {
            const testDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
            if (testDate >= currentDate) {
              nextDate = testDate;
              found = true;
              break;
            }
          }
          
          if (!found) {
            // Ir al primer día del próximo mes
            const firstDay = daysOfMonth[0];
            nextDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, firstDay);
          }
        }
        break;

      default:
        return occurrences;
    }

    if (!nextDate || nextDate > finalEndDate) {
      break;
    }

    // Verificar si excede la fecha de fin de recurrencia
    if (recurrenceEndDate && nextDate > recurrenceEndDate) {
      break;
    }

    // Agregar la ocurrencia
    occurrences.push({
      fecha: new Date(nextDate),
      hora: hora
    });

    currentDate = new Date(nextDate);
    currentDate.setDate(currentDate.getDate() + 1);
    count++;
  }

  return occurrences;
};

/**
 * Calcula la próxima ocurrencia de una actividad recurrente sin generarla
 * @param {Object} activity - La actividad recurrente
 * @param {Date} fromDate - Fecha desde la cual calcular (opcional, por defecto hoy o fecha de inicio)
 * @returns {Date|null} La fecha de la próxima ocurrencia o null si no hay más ocurrencias
 */
export const calculateNextOccurrence = (activity, fromDate = null) => {
  if (activity.tipo !== 'recurrente' || !activity.recurrence) {
    return null;
  }

  const { recurrence } = activity;
  // Usar fecha de inicio de la actividad si existe y es en el futuro, o fromDate, o hoy
  let baseDate = fromDate ? new Date(fromDate) : new Date();
  if (activity.fecha && new Date(activity.fecha) > new Date()) {
    baseDate = new Date(activity.fecha);
  }
  const currentDate = baseDate;
  currentDate.setHours(0, 0, 0, 0);
  
  const endDate = recurrence.endDate ? new Date(recurrence.endDate) : null;
  let nextDate = null;

  switch (recurrence.frequency) {
    case 'daily':
      nextDate = new Date(currentDate);
      nextDate.setDate(nextDate.getDate() + 1);
      break;

    case 'weekly':
      if (recurrence.daysOfWeek && recurrence.daysOfWeek.length > 0) {
        const daysOfWeek = recurrence.daysOfWeek.sort((a, b) => a - b);
        let found = false;
        
        for (const dayOfWeek of daysOfWeek) {
          const daysUntil = (dayOfWeek - currentDate.getDay() + 7) % 7;
          if (daysUntil > 0) {
            nextDate = new Date(currentDate);
            nextDate.setDate(nextDate.getDate() + daysUntil);
            found = true;
            break;
          }
        }
        
        if (!found) {
          // Si no hay más días esta semana, ir al primero de la próxima semana
          const firstDay = daysOfWeek[0];
          const daysUntil = (firstDay - currentDate.getDay() + 7) % 7;
          nextDate = new Date(currentDate);
          nextDate.setDate(nextDate.getDate() + (daysUntil || 7));
        }
      } else if (recurrence.dayOfWeek !== undefined) {
        // Compatibilidad con el formato antiguo
        const daysUntil = (recurrence.dayOfWeek - currentDate.getDay() + 7) % 7;
        nextDate = new Date(currentDate);
        nextDate.setDate(nextDate.getDate() + (daysUntil || 7));
      }
      break;

    case 'monthly':
      if (recurrence.dayOfMonth && recurrence.dayOfMonth.length > 0) {
        const daysOfMonth = recurrence.dayOfMonth.sort((a, b) => a - b);
        let found = false;
        
        for (const day of daysOfMonth) {
          const testDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
          if (testDate >= currentDate) {
            nextDate = testDate;
            found = true;
            break;
          }
        }
        
        if (!found) {
          // Ir al primer día del próximo mes
          const firstDay = daysOfMonth[0];
          nextDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, firstDay);
        }
      }
      break;

    default:
      return null;
  }

  if (!nextDate) {
    return null;
  }

  // Verificar si excede la fecha de fin
  if (endDate && nextDate > endDate) {
    return null;
  }

  return nextDate;
};
