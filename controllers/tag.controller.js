import Tag from '../models/Tag.model.js';
import Activity from '../models/Activity.model.js';
import User from '../models/User.model.js';
import { validationResult } from 'express-validator';

export const getTags = async (req, res) => {
  try {
    const { activa } = req.query;
    const query = {};
    const isAdmin = req.user?.role === 'admin';

    if (!isAdmin) {
      query.activa = true;
    } else if (activa !== undefined) {
      query.activa = activa === 'true';
    }

    const tags = await Tag.find(query).sort({ nombre: 1 });
    res.json({ tags, count: tags.length });
  } catch (error) {
    console.error('Error al obtener tags:', error);
    res.status(500).json({ message: 'Error al obtener tags', error: error.message });
  }
};

export const getTagById = async (req, res) => {
  try {
    const tag = await Tag.findById(req.params.id);
    if (!tag) {
      return res.status(404).json({ message: 'Tag no encontrada' });
    }
    if (req.user?.role !== 'admin' && !tag.activa) {
      return res.status(404).json({ message: 'Tag no encontrada' });
    }
    res.json({ tag });
  } catch (error) {
    console.error('Error al obtener tag:', error);
    res.status(500).json({ message: 'Error al obtener tag', error: error.message });
  }
};

export const createTag = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { nombre, descripcion, color } = req.body;
    
    // Normalizar nombre a lowercase
    const nombreNormalizado = nombre.toLowerCase().trim();

    // Verificar si ya existe
    const tagExistente = await Tag.findOne({ nombre: nombreNormalizado });
    if (tagExistente) {
      return res.status(400).json({ message: 'Ya existe una tag con ese nombre' });
    }

    const tag = new Tag({
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
    console.error('Error al crear tag:', error);
    res.status(500).json({ message: 'Error al crear tag', error: error.message });
  }
};

export const updateTag = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const tag = await Tag.findById(req.params.id);
    if (!tag) {
      return res.status(404).json({ message: 'Tag no encontrada' });
    }

    const { nombre, descripcion, color, activa } = req.body;

    // Si se está cambiando el nombre, verificar que no exista otra tag con ese nombre
    if (nombre && nombre.toLowerCase().trim() !== tag.nombre) {
      const nombreNormalizado = nombre.toLowerCase().trim();
      const tagExistente = await Tag.findOne({ 
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
    console.error('Error al actualizar tag:', error);
    res.status(500).json({ message: 'Error al actualizar tag', error: error.message });
  }
};

export const deleteTag = async (req, res) => {
  try {
    const tag = await Tag.findById(req.params.id);
    if (!tag) {
      return res.status(404).json({ message: 'Tag no encontrada' });
    }

    // Verificar si la tag está en uso
    // Las tags pueden estar guardadas en diferentes formatos, así que buscamos case-insensitive
    const tagNombre = tag.nombre.toLowerCase();
    const tagRegex = new RegExp(`^${tagNombre}$`, 'i');
    
    // Obtener todas las actividades y usuarios y filtrar manualmente
    const [allActivities, allUsers] = await Promise.all([
      Activity.find({}).select('tagsVisibilidad'),
      User.find({}).select('tags')
    ]);
    
    const activitiesUsingTag = allActivities.filter(activity => {
      if (!activity.tagsVisibilidad || activity.tagsVisibilidad.length === 0) return false;
      return activity.tagsVisibilidad.some(t => tagRegex.test(t));
    }).length;
    
    const usersUsingTag = allUsers.filter(user => {
      if (!user.tags || user.tags.length === 0) return false;
      return user.tags.some(t => tagRegex.test(t));
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

    await Tag.findByIdAndDelete(req.params.id);
    res.json({ message: 'Tag eliminada exitosamente' });
  } catch (error) {
    console.error('Error al eliminar tag:', error);
    res.status(500).json({ message: 'Error al eliminar tag', error: error.message });
  }
};

