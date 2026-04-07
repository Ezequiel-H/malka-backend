import User from '../models/User.model.js';
import mongoose from 'mongoose';
import { validationResult } from 'express-validator';
import { messageFromMongoDuplicate } from '../utils/mongoDuplicate.js';

const normalizeDni = (v) => String(v ?? '').replace(/\s/g, '').trim();
const normalizePhone = (v) => String(v ?? '').replace(/\s/g, '').trim();

async function assertIdentityAvailable({ excludeUserId, dni, telefono }) {
  const or = [];
  if (dni) or.push({ dni });
  if (telefono) or.push({ telefono });
  if (!or.length) return;

  const clash = await User.findOne({
    _id: { $ne: excludeUserId },
    $or: or
  }).select('dni telefono');

  if (!clash) return;

  if (dni && clash.dni === dni) {
    const err = new Error('DUPLICATE_DNI');
    err.statusCode = 409;
    throw err;
  }
  if (telefono && clash.telefono === telefono) {
    const err = new Error('DUPLICATE_TELEFONO');
    err.statusCode = 409;
    throw err;
  }
}

export const getPendingUsers = async (req, res) => {
  try {
    const users = await User.find({ estado: 'pending' })
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({ users });
  } catch (error) {
    console.error('Error al obtener usuarios pendientes:', error);
    res.status(500).json({ message: 'Error al obtener usuarios pendientes', error: error.message });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const { estado, role, search } = req.query;
    const query = {};

    if (estado) query.estado = estado;
    if (role) query.role = role;
    if (search) {
      query.$or = [
        { nombre: { $regex: search, $options: 'i' } },
        { apellido: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({ users });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ message: 'Error al obtener usuarios', error: error.message });
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID de usuario inválido' });
    }

    const user = await User.findById(id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ message: 'Error al obtener usuario', error: error.message });
  }
};

export const approveUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    user.estado = 'approved';
    await user.save();

    res.json({
      message: 'Usuario aprobado exitosamente',
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        estado: user.estado
      }
    });
  } catch (error) {
    console.error('Error al aprobar usuario:', error);
    res.status(500).json({ message: 'Error al aprobar usuario', error: error.message });
  }
};

export const rejectUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    user.estado = 'rejected';
    await user.save();

    res.json({
      message: 'Usuario rechazado',
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        estado: user.estado
      }
    });
  } catch (error) {
    console.error('Error al rechazar usuario:', error);
    res.status(500).json({ message: 'Error al rechazar usuario', error: error.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      nombre,
      apellido,
      dni,
      telefono,
      tags,
      tagsPrivados,
      intereses,
      segmentoPublico,
      nivelParticipacion,
      estado,
      restriccionesAlimentarias,
      comoSeEntero
    } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const nextDni = dni !== undefined ? normalizeDni(dni) : user.dni;
    const nextTel =
      telefono !== undefined ? normalizePhone(telefono) : user.telefono;

    try {
      await assertIdentityAvailable({
        excludeUserId: user._id,
        dni: nextDni || undefined,
        telefono: nextTel || undefined
      });
    } catch (e) {
      if (e.statusCode === 409) {
        const msg =
          e.message === 'DUPLICATE_DNI'
            ? 'Ya existe una cuenta con ese DNI.'
            : 'Ya existe una cuenta con ese teléfono.';
        return res.status(409).json({ message: msg });
      }
      throw e;
    }

    if (nombre) user.nombre = nombre;
    if (apellido) user.apellido = apellido;
    if (dni !== undefined) user.dni = nextDni || undefined;
    if (telefono !== undefined) user.telefono = nextTel || undefined;
    if (tags) user.tags = tags;
    if (tagsPrivados !== undefined) user.tagsPrivados = tagsPrivados;
    if (intereses) user.intereses = intereses;
    if (segmentoPublico !== undefined) user.segmentoPublico = segmentoPublico;
    if (nivelParticipacion !== undefined) user.nivelParticipacion = nivelParticipacion;
    if (restriccionesAlimentarias !== undefined) {
      user.restriccionesAlimentarias = restriccionesAlimentarias;
    }
    if (comoSeEntero !== undefined) user.comoSeEntero = comoSeEntero;
    if (estado && ['pending', 'approved', 'rejected'].includes(estado)) {
      user.estado = estado;
    }

    await user.save();

    res.json({
      message: 'Usuario actualizado exitosamente',
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        dni: user.dni,
        telefono: user.telefono,
        tags: user.tags,
        tagsPrivados: user.tagsPrivados,
        estado: user.estado
      }
    });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    const dupMsg = messageFromMongoDuplicate(error);
    if (dupMsg) {
      return res.status(409).json({ message: dupMsg });
    }
    res.status(500).json({ message: 'Error al actualizar usuario', error: error.message });
  }
};

/**
 * Perfil del participante autenticado: POST /onboarding y PATCH /me.
 */
export const updateMyProfile = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      nombre,
      apellido,
      dni,
      telefono,
      restriccionesAlimentarias,
      comoSeEntero,
      tags
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const nextDni = dni !== undefined ? normalizeDni(dni) : user.dni;
    const nextTel = telefono !== undefined ? normalizePhone(telefono) : user.telefono;

    try {
      await assertIdentityAvailable({
        excludeUserId: user._id,
        dni: nextDni || undefined,
        telefono: nextTel || undefined
      });
    } catch (e) {
      if (e.statusCode === 409) {
        const msg =
          e.message === 'DUPLICATE_DNI'
            ? 'Ya existe una cuenta con ese DNI.'
            : 'Ya existe una cuenta con ese teléfono.';
        return res.status(409).json({ message: msg });
      }
      throw e;
    }

    if (nombre !== undefined) user.nombre = nombre;
    if (apellido !== undefined) user.apellido = apellido;
    if (dni !== undefined) user.dni = nextDni || undefined;
    if (telefono !== undefined) user.telefono = nextTel || undefined;
    if (restriccionesAlimentarias !== undefined) {
      user.restriccionesAlimentarias = restriccionesAlimentarias;
    }
    if (comoSeEntero !== undefined) user.comoSeEntero = comoSeEntero;
    if (tags !== undefined) {
      user.tags = Array.isArray(tags) ? tags : user.tags;
    }
    user.onboardingCompleted = true;

    await user.save();

    const fresh = await User.findById(user._id).select('-password');
    res.json({ user: fresh });
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    const dupMsg = messageFromMongoDuplicate(error);
    if (dupMsg) {
      return res.status(409).json({ message: dupMsg });
    }
    res.status(500).json({ message: 'Error al actualizar perfil', error: error.message });
  }
};

export const getUsersByTags = async (req, res) => {
  try {
    const { tags } = req.query;
    if (!tags) {
      return res.status(400).json({ message: 'Se requiere al menos un tag' });
    }

    const tagsArray = Array.isArray(tags) ? tags : [tags];
    const users = await User.find({
      tags: { $in: tagsArray },
      estado: 'approved'
    })
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({ users, count: users.length });
  } catch (error) {
    console.error('Error al obtener usuarios por tags:', error);
    res.status(500).json({ message: 'Error al obtener usuarios por tags', error: error.message });
  }
};

