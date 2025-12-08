import User from '../models/User.model.js';
import { validationResult } from 'express-validator';

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
    const user = await User.findById(req.params.id).select('-password');
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

    const { nombre, apellido, telefono, tags, intereses, categoriasArtisticas, segmentoPublico, nivelParticipacion } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    if (nombre) user.nombre = nombre;
    if (apellido) user.apellido = apellido;
    if (telefono !== undefined) user.telefono = telefono;
    if (tags) user.tags = tags;
    if (intereses) user.intereses = intereses;
    if (categoriasArtisticas) user.categoriasArtisticas = categoriasArtisticas;
    if (segmentoPublico !== undefined) user.segmentoPublico = segmentoPublico;
    if (nivelParticipacion !== undefined) user.nivelParticipacion = nivelParticipacion;

    await user.save();

    res.json({
      message: 'Usuario actualizado exitosamente',
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        telefono: user.telefono,
        tags: user.tags,
        estado: user.estado
      }
    });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ message: 'Error al actualizar usuario', error: error.message });
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

