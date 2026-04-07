import mongoose from 'mongoose';

const privateTagSchema = new mongoose.Schema({
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
    default: '#3B82F6',
    trim: true
  },
  activa: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'private_tags'
});

privateTagSchema.index({ activa: 1 });

const PrivateTag = mongoose.model('PrivateTag', privateTagSchema);

export default PrivateTag;
