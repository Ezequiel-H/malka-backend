import mongoose from 'mongoose';

const recurrenceSchema = new mongoose.Schema({
  frequency: {
    type: String,
    enum: ['weekly', 'monthly', 'daily'],
    required: function() {
      return this.parent().tipo === 'recurrente';
    }
  },
  dayOfWeek: {
    type: Number, // 0 = Domingo, 1 = Lunes, etc. (mantener para compatibilidad)
    min: 0,
    max: 6
  },
  daysOfWeek: {
    type: [Number], // Array para múltiples días de la semana
    validate: {
      validator: function(v) {
        if (this.frequency === 'weekly') {
          return Array.isArray(v) && v.length > 0 && v.every(day => day >= 0 && day <= 6);
        }
        return true;
      },
      message: 'Debe seleccionar al menos un día de la semana'
    }
  },
  dayOfMonth: {
    type: [Number], // Array para múltiples días del mes
    validate: {
      validator: function(v) {
        if (this.frequency === 'monthly') {
          return Array.isArray(v) && v.length > 0 && v.every(day => day >= 1 && day <= 31);
        }
        return true;
      },
      message: 'Debe seleccionar al menos un día del mes (1-31)'
    }
  },
  endDate: {
    type: Date
  },
  occurrences: {
    type: Number, // Número de ocurrencias
    min: 1
  },
  hora: {
    type: String // Hora para actividades recurrentes
  }
}, { _id: false });

const activitySchema = new mongoose.Schema({
  titulo: {
    type: String,
    required: [true, 'El título es requerido'],
    trim: true
  },
  descripcion: {
    type: String,
    required: [true, 'La descripción es requerida'],
    trim: true
  },
  fotos: {
    type: [String],
    default: []
  },
  categorias: {
    type: [String],
    default: []
  },
  // Para actividades únicas
  fecha: {
    type: Date
  },
  hora: {
    type: String,
    trim: true
  },
  // Para actividades recurrentes
  tipo: {
    type: String,
    enum: ['unica', 'recurrente'],
    required: true,
    default: 'unica'
  },
  recurrence: {
    type: recurrenceSchema
  },
  lugar: {
    type: String,
    trim: true
  },
  ubicacionOnline: {
    type: String, // Link de Google Maps
    trim: true
  },
  precio: {
    type: Number,
    default: 0,
    min: 0
  },
  esGratuita: {
    type: Boolean,
    default: true
  },
  cupo: {
    type: Number,
    min: 0
  },
  requiereAprobacion: {
    type: Boolean,
    default: false
  },
  estado: {
    type: String,
    enum: ['borrador', 'publicada', 'eliminada'],
    default: 'borrador'
  },
  organizadorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  duracion: {
    type: Number, // en minutos
    min: 0
  },
  politicaCancelacion: {
    type: String,
    trim: true
  },
  recordatoriosAutomaticos: {
    type: Boolean,
    default: true
  },
  visibilidad: {
    type: String,
    enum: ['publica', 'privada'],
    default: 'publica'
  },
  tagsVisibilidad: {
    type: [String], // Tags requeridos para ver esta actividad
    default: []
  }
}, {
  timestamps: true
});

// Indexes for better query performance
activitySchema.index({ estado: 1, fecha: 1 });
activitySchema.index({ categorias: 1 });
activitySchema.index({ organizadorId: 1 });

const Activity = mongoose.model('Activity', activitySchema);

export default Activity;

