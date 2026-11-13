import mongoose from 'mongoose';

/**
 * Una vez que alguien vino, cuando no sale de una inscripción:
 * - `sin_anotarse`: vino a un encuentro de una actividad sin inscribirse
 *   (lo suma el equipo desde las inscripciones de la actividad).
 * - `manual`: el equipo lo cargó en el historial (p. ej. un evento que no
 *   está en la app).
 * - `importado`: vino de la planilla histórica.
 *
 * La persona es una cuenta (`userId`) o un contacto (`contactoId`). El
 * encuentro es una actividad de la app (`actividadId` + `fecha`) o un evento
 * con nombre propio (`evento` + `fecha`). Las inscripciones aceptadas no se
 * copian acá: el historial las suma al leer.
 */
export const ORIGENES_VISITA = ['sin_anotarse', 'manual', 'importado'];

const visitaSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    contactoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contacto' },
    actividadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity' },
    evento: { type: String, trim: true, maxlength: 160 },
    fecha: { type: Date, required: [true, 'La fecha es requerida'] },
    categoria: { type: String, trim: true, maxlength: 60 },
    subcategoria: { type: String, trim: true, maxlength: 60 },
    origen: { type: String, enum: ORIGENES_VISITA, default: 'manual' },
    notas: { type: String, trim: true, maxlength: 1000 },
    creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

visitaSchema.pre('validate', function exigirPersonaYEncuentro(next) {
  if (!this.userId && !this.contactoId) this.invalidate('userId', 'Falta la persona');
  if (!this.actividadId && !this.evento) this.invalidate('evento', 'Falta la actividad o el evento');
  next();
});

visitaSchema.index({ fecha: -1 });
visitaSchema.index({ userId: 1, fecha: 1 });
visitaSchema.index({ contactoId: 1, fecha: 1 });
visitaSchema.index({ actividadId: 1, fecha: 1 });

const Visita = mongoose.model('Visita', visitaSchema);

export default Visita;
