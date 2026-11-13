import mongoose from 'mongoose';

/**
 * Una persona que vino a Malka pero no tiene cuenta en la app: la que llegó
 * a una actividad sin anotarse, la que estaba en la planilla vieja, la que
 * el equipo cargó a mano. Si después se registra con el mismo mail, el
 * contacto queda atado a su cuenta (`usuarioId`) y su historial se junta.
 */
export const ORIGENES_CONTACTO = ['importado', 'manual', 'sin_anotarse'];

const contactoSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: [true, 'El nombre es requerido'], trim: true, maxlength: 80 },
    apellido: { type: String, trim: true, maxlength: 80, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    telefono: { type: String, trim: true, maxlength: 30 },
    fechaNacimiento: {
      type: String,
      trim: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'La fecha de nacimiento debe tener formato YYYY-MM-DD']
    },
    notas: { type: String, trim: true, maxlength: 1000 },
    origen: { type: String, enum: ORIGENES_CONTACTO, default: 'manual' },
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

contactoSchema.index({ email: 1 }, { sparse: true });
contactoSchema.index({ nombre: 1, apellido: 1 });

const Contacto = mongoose.model('Contacto', contactoSchema);

export default Contacto;
