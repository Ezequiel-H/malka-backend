import mongoose from 'mongoose';

const inscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  activityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Activity',
    required: true
  },
  fecha: {
    type: Date,
    required: true
  },
  hora: {
    type: String,
    trim: true
  },
  estado: {
    type: String,
    enum: ['pendiente', 'aceptada', 'cancelada', 'en_espera'],
    default: 'pendiente'
  },
  fechaInscripcion: {
    type: Date,
    default: Date.now
  },
  fechaCancelacion: {
    type: Date
  },
  fechaAprobacion: {
    type: Date
  },
  notas: {
    type: String,
    trim: true
  },
  pago: {
    comprobante: {
      url: String,
      publicId: String,
      formato: String,
      originalName: String
    },
    estadoPago: {
      type: String,
      enum: ['pendiente', 'aprobado', 'rechazado']
    },
    montoEsperado: {
      type: Number,
      min: 0
    },
    fechaRevision: Date,
    motivoRechazo: String,
    revisadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }
}, {
  timestamps: true
});

// Indexes
// Índice único: un usuario solo puede inscribirse una vez por actividad y fecha
inscriptionSchema.index({ userId: 1, activityId: 1, fecha: 1 }, { unique: true });
inscriptionSchema.index({ activityId: 1, estado: 1 });
inscriptionSchema.index({ activityId: 1, fecha: 1 });
inscriptionSchema.index({ userId: 1, estado: 1 });
inscriptionSchema.index({ fecha: 1 });

const Inscription = mongoose.model('Inscription', inscriptionSchema);

export default Inscription;

