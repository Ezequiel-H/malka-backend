import PrivateTag from '../models/PrivateTag.model.js';
import Activity from '../models/Activity.model.js';
import User from '../models/User.model.js';
import { validationResult } from 'express-validator';

export const getPrivateTags = async (req, res) => {
  try {
    const { activa } = req.query;
    const query = {};

    if (activa !== undefined) {
      query.activa = activa === 'true';
    }

    const tags = await PrivateTag.find(query).sort({ nombre: 1 });
    res.json({ tags, count: tags.length });
  } catch (error) {
    console.error('Error al obtener tags privados:', error);
    res.status(500).json({ message: 'Error al obtener tags privados', error: error.message });
  }
};

export const getPrivateTagById = async (req, res) => {
  try {
    const tag = await PrivateTag.findById(req.params.id);
    if (!tag) {
      return res.status(404).json({ message: 'Tag no encontrada' });
    }
    res.json({ tag });
  } catch (error) {
    console.error('Error al obtener tag privada:', error);
    res.status(500).json({ message: 'Error al obtener tag privada', error: error.message });
  }
};

export const createPrivateTag = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { nombre, descripcion, color } = req.body;
    const nombreNormalizado = nombre.toLowerCase().trim();

    const tagExistente = await PrivateTag.findOne({ nombre: nombreNormalizado });
    if (tagExistente) {
      return res.status(400).json({ message: 'Ya existe una tag con ese nombre' });
    }

    const tag = new PrivateTag({
      nombre: nombreNormalizado,
      descripcion: descripcion || '',
      color: color || '#3B82F6',
      activa: true
    });

    await tag.save();
    res.status(201).json({
      message: 'Tag creada exitosamente',
      tag
    });
  } catch (error) {
    console.error('Error al crear tag privada:', error);
    res.status(500).json({ message: 'Error al crear tag privada', error: error.message });
  }
};

export const updatePrivateTag = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const tag = await PrivateTag.findById(req.params.id);
    if (!tag) {
      return res.status(404).json({ message: 'Tag no encontrada' });
    }

    const { nombre, descripcion, color, activa } = req.body;

    if (nombre && nombre.toLowerCase().trim() !== tag.nombre) {
      const nombreNormalizado = nombre.toLowerCase().trim();
      const tagExistente = await PrivateTag.findOne({
        nombre: nombreNormalizado,
        _id: { $ne: req.params.id }
      });
      if (tagExistente) {
        return res.status(400).json({ message: 'Ya existe una tag con ese nombre' });
      }
      tag.nombre = nombreNormalizado;
    }

    if (descripcion !== undefined) tag.descripcion = descripcion;
    if (color !== undefined) tag.color = color;
    if (activa !== undefined) tag.activa = activa;

    await tag.save();
    res.json({
      message: 'Tag actualizada exitosamente',
      tag
    });
  } catch (error) {
    console.error('Error al actualizar tag privada:', error);
    res.status(500).json({ message: 'Error al actualizar tag privada', error: error.message });
  }
};

export const deletePrivateTag = async (req, res) => {
  try {
    const tag = await PrivateTag.findById(req.params.id);
    if (!tag) {
      return res.status(404).json({ message: 'Tag no encontrada' });
    }

    const tagNombre = tag.nombre.toLowerCase();
    const tagRegex = new RegExp(`^${tagNombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

    const [allActivities, allUsers] = await Promise.all([
      Activity.find({}).select('tagsPrivados'),
      User.find({}).select('tagsPrivados')
    ]);

    const activitiesUsingTag = allActivities.filter((activity) => {
      const priv = activity.tagsPrivados || [];
      return priv.some((t) => tagRegex.test(t));
    }).length;

    const usersUsingTag = allUsers.filter((user) => {
      if (!user.tagsPrivados || user.tagsPrivados.length === 0) return false;
      return user.tagsPrivados.some((t) => tagRegex.test(t));
    }).length;

    if (activitiesUsingTag > 0 || usersUsingTag > 0) {
      return res.status(400).json({
        message: 'No se puede eliminar la tag porque está en uso',
        details: {
          actividades: activitiesUsingTag,
          usuarios: usersUsingTag
        }
      });
    }

    await PrivateTag.findByIdAndDelete(req.params.id);
    res.json({ message: 'Tag eliminada exitosamente' });
  } catch (error) {
    console.error('Error al eliminar tag privada:', error);
    res.status(500).json({ message: 'Error al eliminar tag privada', error: error.message });
  }
};
