import User from '../models/User.model.js';
import Inscription from '../models/Inscription.model.js';

const MUESTRA = 4;
const nombreDe = (u) => (u ? [u.nombre, u.apellido].filter(Boolean).join(' ') : null);

/* Los títulos de las actividades de una lista, del que más se repite al que menos. */
const actividadesDe = (lista) => {
  const cuenta = new Map();
  for (const i of lista) {
    const t = i.activityId?.titulo;
    if (t) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
  }
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
};

const resumen = (lista) => ({
  cantidad: lista.length,
  actividades: actividadesDe(lista).slice(0, 2),
  nombres: [...new Set(lista.map((i) => nombreDe(i.userId)).filter(Boolean))].slice(0, MUESTRA),
  masAntigua: lista.length ? lista.reduce((min, i) => (i.createdAt < min ? i.createdAt : min), lista[0].createdAt) : null,
});

/**
 * GET /api/admin/hoy — lo que el equipo tiene para hacer: altas por aprobar,
 * inscripciones por confirmar y comprobantes de pago por revisar. Los números
 * del mes salen de /metrics y la semana de /actividades-resumen.
 */
export const getHoy = async (req, res) => {
  try {
    const [personas, inscripciones, comprobantes] = await Promise.all([
      User.find({ role: 'participant', estado: 'pending' }).select('nombre apellido createdAt').sort({ createdAt: 1 }).lean(),
      Inscription.find({ estado: 'pendiente' }).select('userId activityId createdAt').populate('userId', 'nombre apellido').populate('activityId', 'titulo estado').lean(),
      Inscription.find({ estado: { $ne: 'cancelada' }, 'pago.estadoPago': 'pendiente', 'pago.comprobante.url': { $exists: true, $nin: [null, ''] } })
        .select('userId activityId createdAt')
        .populate('userId', 'nombre apellido')
        .populate('activityId', 'titulo estado')
        .lean(),
    ]);
    // Lo de actividades borradas no es trabajo pendiente.
    const vivas = (lista) => lista.filter((i) => i.activityId && i.activityId.estado !== 'eliminada');
    res.json({
      personas: {
        cantidad: personas.length,
        nombres: personas.slice(0, MUESTRA).map(nombreDe),
        masAntigua: personas[0]?.createdAt ?? null,
      },
      inscripciones: resumen(vivas(inscripciones)),
      comprobantes: resumen(vivas(comprobantes)),
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al armar lo pendiente', error: error.message });
  }
};
