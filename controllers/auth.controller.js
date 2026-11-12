import User from '../models/User.model.js';
import { normalizarDocumento } from '../utils/documento.js';
import Settings from '../models/Settings.model.js';
import { generateToken } from '../utils/generateToken.js';
import { validationResult } from 'express-validator';
import { messageFromMongoDuplicate } from '../utils/mongoDuplicate.js';
import { assertValidBirthDate } from '../utils/calendarDate.js';

const normalizeDni = normalizarDocumento;
const normalizePhone = (v) => String(v ?? '').replace(/\s/g, '').trim();
const sanitizeUserForParticipant = (userDoc) => {
  const user = typeof userDoc?.toObject === 'function' ? userDoc.toObject() : userDoc;
  if (!user) return user;
  const { tagsPrivados, ...rest } = user;
  return rest;
};

export const register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      email,
      password,
      nombre,
      apellido,
      dni,
      telefono,
      restriccionesAlimentarias,
      comoSeEntero,
      fechaNacimiento,
      tags,
      nacionalidad,
      residencia,
      ciudad,
      idioma,
      tipoDocumento
    } = req.body;

    const dniNorm = normalizeDni(dni);
    const telNorm = normalizePhone(telefono);
    const tagsList = Array.isArray(tags) ? tags : [];

    const emailLower = email.toLowerCase().trim();
    if (await User.findOne({ email: emailLower })) {
      return res.status(409).json({ message: 'El email ya está registrado' });
    }
    if (await User.findOne({ dni: dniNorm })) {
      return res.status(409).json({ message: 'Ya existe una cuenta con ese DNI.' });
    }
    if (await User.findOne({ telefono: telNorm })) {
      return res.status(409).json({ message: 'Ya existe una cuenta con ese teléfono.' });
    }

    const user = new User({
      email,
      password,
      nombre,
      apellido,
      dni: dniNorm,
      telefono: telNorm,
      restriccionesAlimentarias: restriccionesAlimentarias || [],
      comoSeEntero: comoSeEntero || '',
      fechaNacimiento: assertValidBirthDate(fechaNacimiento),
      tags: tagsList,
      nacionalidad,
      residencia,
      ciudad: residencia === 'buenos_aires' ? undefined : ciudad,
      idioma,
      tipoDocumento: tipoDocumento === 'pasaporte' ? 'pasaporte' : 'dni'
    });

    await user.save();

    const token = generateToken(user._id);

    res.status(201).json({
      message: 'Usuario registrado exitosamente. Tu cuenta está pendiente de aprobación.',
      token,
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        dni: user.dni,
        telefono: user.telefono,
        fechaNacimiento: user.fechaNacimiento,
        role: user.role,
        estado: user.estado,
        tags: user.tags,
        idioma: user.idioma
      }
    });
  } catch (error) {
    console.error('Error en registro:', error);
    const dupMsg = messageFromMongoDuplicate(error);
    if (dupMsg) {
      return res.status(409).json({ message: dupMsg });
    }
    res.status(500).json({ message: 'Error al registrar usuario', error: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const token = generateToken(user._id);

    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        fechaNacimiento: user.fechaNacimiento,
        role: user.role,
        estado: user.estado,
        tags: user.tags,
        idioma: user.idioma
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: 'Error al iniciar sesión', error: error.message });
  }
};

export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({
      user: req.user.role === 'participant' ? sanitizeUserForParticipant(user) : user
    });
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ message: 'Error al obtener usuario', error: error.message });
  }
};

/**
 * GET /api/auth/registro-whatsapp — a dónde y qué escribir para terminar el
 * registro quien no vive en Buenos Aires. El número y el mensaje salen de
 * Ajustes; las variables ({nombre}, {ciudad}) las completa el front.
 */
export const getRegistroWhatsapp = async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.json({
      completarPorWhatsapp:
        req.user.role === 'participant' &&
        ((Boolean(req.user.residencia) && req.user.residencia !== 'buenos_aires') || req.user.tipoDocumento === 'pasaporte'),
      numero: settings.whatsappNumero,
      mensaje: settings.whatsappRegistroMensaje
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al buscar el contacto de WhatsApp', error: error.message });
  }
};
