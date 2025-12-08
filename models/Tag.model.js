import mongoose from 'mongoose';

const tagSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: [true, 'El nombre de la tag es requerido'],
    unique: true,
    trim: true,
    lowercase: true
  },
  descripcion: {
    type: String,
    trim: true
  },
  color: {
    type: String,
    default: '#3B82F6', // Color azul por defecto
    trim: true
  },
  activa: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index para búsquedas rápidas
// Note: nombre already has an index from unique: true
tagSchema.index({ activa: 1 });

const Tag = mongoose.model('Tag', tagSchema);

export default Tag;

