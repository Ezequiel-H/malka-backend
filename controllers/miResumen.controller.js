import { DateTime } from 'luxon';
import Inscription from '../models/Inscription.model.js';
import Visita from '../models/Visita.model.js';
import Contacto from '../models/Contacto.model.js';
import { ARGENTINA_TZ } from '../utils/argentinaTime.js';

/**
 * GET /api/me/resumen — cuántas veces vino quien está logueado en lo que va
 * del año: inscripciones aceptadas ya pasadas (menos las que faltó) más las
 * visitas del historial (sin anotarse, a mano o de la planilla), las suyas o
 * las de un contacto unido a su cuenta. Es lo único que ve de su historial.
 */
export const getMiResumen = async (req, res) => {
  try {
    const ahora = DateTime.now().setZone(ARGENTINA_TZ);
    const desde = ahora.startOf('year').toUTC().toJSDate();
    const hasta = new Date();
    const contactos = await Contacto.find({ usuarioId: req.user._id }).select('_id').lean();
    const [inscripciones, visitas] = await Promise.all([
      Inscription.countDocuments({ userId: req.user._id, estado: 'aceptada', asistencia: { $ne: 'falto' }, fecha: { $gte: desde, $lte: hasta } }),
      Visita.countDocuments({
        $or: [{ userId: req.user._id }, ...(contactos.length ? [{ contactoId: { $in: contactos.map((c) => c._id) } }] : [])],
        fecha: { $gte: desde, $lte: hasta },
      }),
    ]);
    res.json({ anio: ahora.year, veces: inscripciones + visitas });
  } catch (error) {
    res.status(500).json({ message: 'Error al armar tu resumen', error: error.message });
  }
};
