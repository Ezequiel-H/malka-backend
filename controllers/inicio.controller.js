import User from '../models/User.model.js';
import { CATALOGO, esElDeSiempre, normalizarInicio, validarInicio } from '../utils/inicioPanel.js';

const respuesta = (u) => ({ bloques: normalizarInicio(u?.inicioPanel), personalizado: Boolean(u?.inicioPanel), catalogo: CATALOGO });

/** GET /api/admin/inicio — el Panel de quien entra, con el catálogo de bloques. */
export const getInicio = async (req, res) => {
  try {
    const u = await User.findById(req.user._id).select('inicioPanel').lean();
    res.json(respuesta(u));
  } catch (error) {
    res.status(500).json({ message: 'Error al leer el panel', error: error.message });
  }
};

/**
 * PUT /api/admin/inicio — guarda el Panel. Si queda igual al de siempre se
 * borra, así lo que se sume después al Panel de entrada le aparece solo.
 */
export const guardarInicio = async (req, res) => {
  try {
    const { bloques, error } = validarInicio(req.body);
    if (error) return res.status(400).json({ message: error });
    const cambio = esElDeSiempre(bloques) ? { $unset: { inicioPanel: 1 } } : { $set: { inicioPanel: { bloques } } };
    const u = await User.findByIdAndUpdate(req.user._id, cambio, { new: true }).select('inicioPanel').lean();
    res.json(respuesta(u));
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar el panel', error: error.message });
  }
};

/** DELETE /api/admin/inicio — vuelve al Panel de siempre. */
export const borrarInicio = async (req, res) => {
  try {
    const u = await User.findByIdAndUpdate(req.user._id, { $unset: { inicioPanel: 1 } }, { new: true }).select('inicioPanel').lean();
    res.json(respuesta(u));
  } catch (error) {
    res.status(500).json({ message: 'Error al volver al panel de siempre', error: error.message });
  }
};
