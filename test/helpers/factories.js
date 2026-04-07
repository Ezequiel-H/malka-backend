import User from '../../models/User.model.js';
import Activity from '../../models/Activity.model.js';
import Inscription from '../../models/Inscription.model.js';
import Tag from '../../models/Tag.model.js';
import { generateToken } from '../../utils/generateToken.js';

let idCounter = 0;
const uniqueEmail = (prefix = 'user') => {
  idCounter += 1;
  return `${prefix}-${idCounter}@test.local`;
};

export async function createUser(overrides = {}) {
  const email = overrides.email ?? uniqueEmail('u');
  const user = new User({
    password: 'password123',
    nombre: 'Test',
    apellido: 'User',
    dni: String(10_000_000 + idCounter),
    telefono: `+5411${String(90000000 + idCounter).slice(-8)}`,
    role: 'participant',
    estado: 'pending',
    ...overrides,
    email
  });
  await user.save();
  return user;
}

export function bearerFor(user) {
  const token = generateToken(user._id);
  return `Bearer ${token}`;
}

export async function createActivity(organizadorId, overrides = {}) {
  const activity = new Activity({
    titulo: 'Actividad test',
    descripcion: 'Descripción',
    tipo: 'unica',
    estado: 'publicada',
    organizadorId,
    fecha: new Date(Date.UTC(2030, 5, 15, 12, 0, 0, 0)),
    hora: '10:00',
    ...overrides
  });
  await activity.save();
  return activity;
}

export async function createInscription(userId, activityId, fecha, overrides = {}) {
  const ins = new Inscription({
    userId,
    activityId,
    fecha,
    hora: '10:00',
    estado: 'pendiente',
    ...overrides
  });
  await ins.save();
  return ins;
}

export async function createTag(overrides = {}) {
  const t = new Tag({
    nombre: `Tag-${idCounter++}`,
    activa: true,
    ...overrides
  });
  await t.save();
  return t;
}
