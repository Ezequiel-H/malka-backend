import mongoose from 'mongoose';

/**
 * Lo que la casa gasta: la comida de un Shabat, el vino de un viernes, los
 * materiales de un taller. Con esto las métricas calculan cuánto cuesta cada
 * encuentro y cuánto de eso se cubre con lo que se recauda.
 *
 * `actividadId` + `fecha` lo atan a un encuentro puntual (opcional: hay gastos
 * de la casa que no son de ninguna actividad). `cantidad` y `unidad` sirven
 * para lo que se registra a mano además del monto (p. ej. 6 botellas de vino).
 */
export const CATEGORIAS_GASTO = ['comida', 'bebida', 'materiales', 'casa', 'otros'];

const gastoSchema = new mongoose.Schema(
  {
    fecha: {
      type: Date,
      required: [true, 'La fecha es requerida']
    },
    concepto: {
      type: String,
      required: [true, 'El concepto es requerido'],
      trim: true,
      maxlength: 120
    },
    categoria: {
      type: String,
      enum: CATEGORIAS_GASTO,
      default: 'otros'
    },
    monto: {
      type: Number,
      required: [true, 'El monto es requerido'],
      min: [0, 'El monto no puede ser negativo']
    },
    moneda: {
      type: String,
      enum: ['ARS', 'USD'],
      default: 'ARS'
    },
    cantidad: {
      type: Number,
      min: 0
    },
    unidad: {
      type: String,
      trim: true,
      maxlength: 40
    },
    actividadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Activity'
    },
    notas: {
      type: String,
      trim: true,
      maxlength: 1000
    },
    creadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

gastoSchema.index({ fecha: 1 });
gastoSchema.index({ actividadId: 1, fecha: 1 });

const Gasto = mongoose.model('Gasto', gastoSchema);

export default Gasto;
