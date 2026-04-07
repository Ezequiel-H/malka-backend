import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'El email es requerido'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Por favor ingresa un email válido']
  },
  password: {
    type: String,
    required: [true, 'La contraseña es requerida'],
    minlength: [6, 'La contraseña debe tener al menos 6 caracteres']
  },
  nombre: {
    type: String,
    required: [true, 'El nombre es requerido'],
    trim: true
  },
  apellido: {
    type: String,
    required: [true, 'El apellido es requerido'],
    trim: true
  },
  dni: {
    type: String,
    trim: true,
    sparse: true,
    unique: true
  },
  telefono: {
    type: String,
    trim: true,
    sparse: true,
    unique: true
  },
  tags: {
    type: [String],
    default: []
  },
  tagsPrivados: {
    type: [String],
    default: []
  },
  role: {
    type: String,
    enum: ['participant', 'admin'],
    default: 'participant'
  },
  estado: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  aprobadoPor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    select: false
  },
  rechazadoPor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    select: false
  },
  segmentoPublico: {
    type: String,
    trim: true
  },
  nivelParticipacion: {
    type: String,
    trim: true
  },
  restriccionesAlimentarias: {
    type: [String],
    default: []
  },
  comoSeEntero: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Evitar documentos con string vacío en campos únicos (solo un "" permitido sin sparse behavior claro)
userSchema.pre('validate', function(next) {
  if (this.telefono === '') this.telefono = undefined;
  if (this.dni === '') this.dni = undefined;
  next();
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get public user data
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

const User = mongoose.model('User', userSchema);

export default User;

