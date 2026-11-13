import { DateTime } from 'luxon';
import Activity from '../models/Activity.model.js';
import Inscription from '../models/Inscription.model.js';
import { ARGENTINA_TZ } from '../utils/argentinaTime.js';
import { calculateOccurrences } from '../utils/generateOccurrences.js';

const DIAS = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ESTADOS = ['publicada', 'borrador', 'eliminada'];
const DIAS_ADELANTE = 120;

/* Los días de los encuentros se guardan como día de calendario: se leen con
   las partes UTC, igual que el resto del back (ver inscription.controller). */
const diaCalendario = (fecha) => new Date(fecha).toISOString().slice(0, 10);
/* generateOccurrences devuelve medianoche local: ese día se lee con las partes locales. */
const diaLocal = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
const fechaCorta = (dia) => {
  const d = new Date(`${dia}T00:00:00.000Z`);
  return `${DIAS_CORTOS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
};
const listaHumana = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0] ?? '');

/**
 * Cuándo es una actividad, dicho como lo diría el equipo: «Todos los viernes
 * · 20:30», «Sáb 23 nov · 11:00», «Del 6 al 8 de dic».
 */
export const cuandoEs = (a) => {
  const hora = a.recurrence?.hora || a.hora;
  const conHora = (texto) => (hora ? `${texto} · ${hora}` : texto);
  if (a.tipo === 'recurrente' && a.recurrence) {
    const r = a.recurrence;
    if (r.frequency === 'daily') return conHora('Todos los días');
    if (r.frequency === 'monthly') {
      const dias = (r.dayOfMonth ?? []).slice().sort((x, y) => x - y);
      return conHora(dias.length ? `Todos los meses, el ${listaHumana(dias.map(String))}` : 'Todos los meses');
    }
    const dias = r.daysOfWeek?.length ? r.daysOfWeek : r.dayOfWeek !== undefined ? [r.dayOfWeek] : [];
    const nombres = [...new Set(dias)].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map((d) => DIAS[d]);
    return conHora(nombres.length ? `Todos los ${listaHumana(nombres)}` : 'Recurrente');
  }
  if (!a.fecha) return 'Sin fecha';
  const inicio = diaCalendario(a.fecha);
  if (a.tipo === 'viaje' && a.fechaFin) {
    const d1 = new Date(`${inicio}T00:00:00.000Z`);
    const d2 = new Date(`${diaCalendario(a.fechaFin)}T00:00:00.000Z`);
    return d1.getUTCMonth() === d2.getUTCMonth()
      ? `Del ${d1.getUTCDate()} al ${d2.getUTCDate()} de ${MESES[d2.getUTCMonth()]}`
      : `Del ${d1.getUTCDate()} de ${MESES[d1.getUTCMonth()]} al ${d2.getUTCDate()} de ${MESES[d2.getUTCMonth()]}`;
  }
  const texto = fechaCorta(inicio);
  return conHora(texto.charAt(0).toUpperCase() + texto.slice(1));
};

/* Los encuentros de una actividad desde un día (YYYY-MM-DD) y los `dias`
   siguientes. Las recurrentes se miran día por día con calculateOccurrences,
   y las semanales con varios días se le pasan con un solo día: con más de
   uno se queda con el primero de la lista que caiga más adelante, aunque
   haya otro antes (de un jueves con martes y jueves salta al martes que
   viene). */
const encuentrosEntre = (a, desde, dias, { primero = false } = {}) => {
  if (a.tipo === 'recurrente' && a.recurrence) {
    const [y, m, d] = desde.split('-').map(Number);
    const encuentros = [];
    for (let i = 0; i <= dias; i += 1) {
      const dia = new Date(y, m - 1, d + i);
      const semanales = a.recurrence.frequency === 'weekly' ? a.recurrence.daysOfWeek ?? [] : [];
      if (semanales.length && !semanales.includes(dia.getDay())) continue;
      const delDia = semanales.length ? { ...a, recurrence: { ...a.recurrence, daysOfWeek: [dia.getDay()] } } : a;
      let ese;
      try {
        ese = calculateOccurrences(delDia, 0, dia).find((o) => diaLocal(o.fecha) === diaLocal(dia));
      } catch {
        return encuentros;
      }
      if (ese) {
        encuentros.push({ dia: diaLocal(dia), hora: ese.hora });
        if (primero) break;
      }
    }
    return encuentros;
  }
  if (!a.fecha) return [];
  const dia = diaCalendario(a.fecha);
  const hasta = DateTime.fromISO(desde, { zone: 'utc' }).plus({ days: dias }).toISODate();
  return dia >= desde && dia <= hasta ? [{ dia, hora: a.hora || '' }] : [];
};

const nombreDe = (u) => [u?.nombre, u?.apellido].filter(Boolean).join(' ');

/**
 * GET /api/admin/actividades-resumen?estado=publicada|borrador|eliminada|todas&q=texto&tags=a,b
 *
 * La lista de actividades del equipo, cada una con lo que hace falta para
 * leerla sin abrirla: cuándo es, el próximo encuentro (con anotados, espera,
 * por aprobar, comprobantes y hasta 8 nombres de quienes vienen) y sus
 * encuentros de esta semana (para la vista Semana). Sin estado devuelve
 * todas menos las eliminadas. Los filtros se suman: estado Y texto Y tags,
 * y entre los tags alcanza con uno.
 */
export const getActividadesResumen = async (req, res) => {
  try {
    const estado = String(req.query.estado ?? '');
    if (estado && estado !== 'todas' && !ESTADOS.includes(estado)) {
      return res.status(400).json({ message: 'Estado inválido' });
    }
    const filtro = !estado ? { estado: { $ne: 'eliminada' } } : estado === 'todas' ? {} : { estado };
    const q = String(req.query.q ?? '').trim();
    if (q) filtro.titulo = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const tags = String(req.query.tags ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length) filtro.categorias = { $in: tags };
    const actividades = await Activity.find(filtro).sort({ createdAt: -1 }).lean();

    const ahora = DateTime.now().setZone(ARGENTINA_TZ);
    const hoy = ahora.toISODate();
    const lunes = ahora.startOf('week').toISODate();
    const domingo = ahora.startOf('week').plus({ days: 6 }).toISODate();

    /* Los encuentros que interesan de cada actividad: los de esta semana y el
       próximo desde hoy. */
    const porActividad = actividades.map((a) => {
      const semana = encuentrosEntre(a, lunes, 6).filter((e) => e.dia >= lunes && e.dia <= domingo);
      const [proximo = null] = encuentrosEntre(a, hoy, DIAS_ADELANTE, { primero: true });
      return { a, semana, proximo };
    });

    const diasQueImportan = new Set(porActividad.flatMap(({ semana, proximo }) => [...semana.map((e) => e.dia), ...(proximo ? [proximo.dia] : [])]));
    const dias = [...diasQueImportan].sort();
    const inscripciones = dias.length
      ? await Inscription.find({
          activityId: { $in: actividades.map((a) => a._id) },
          fecha: { $gte: new Date(`${dias[0]}T00:00:00.000Z`), $lte: new Date(`${dias[dias.length - 1]}T23:59:59.999Z`) },
        })
          .select('userId activityId fecha estado pago.estadoPago pago.comprobante.url')
          .populate('userId', 'nombre apellido')
          .lean()
      : [];
    const delEncuentro = new Map();
    for (const i of inscripciones) {
      const k = `${i.activityId}|${diaCalendario(i.fecha)}`;
      if (!delEncuentro.has(k)) delEncuentro.set(k, []);
      delEncuentro.get(k).push(i);
    }
    const contar = (lista, est) => lista.filter((i) => i.estado === est).length;

    res.json({
      semana: { desde: lunes, hasta: domingo, hoy },
      actividades: porActividad.map(({ a, semana, proximo }) => {
        const lista = proximo ? delEncuentro.get(`${a._id}|${proximo.dia}`) ?? [] : [];
        const aceptadas = lista.filter((i) => i.estado === 'aceptada');
        return {
          id: String(a._id),
          titulo: a.titulo,
          descripcion: a.descripcion,
          tipo: a.tipo,
          estado: a.estado,
          categorias: a.categorias ?? [],
          precio: a.precio ?? 0,
          moneda: a.moneda ?? 'ARS',
          esGratuita: a.esGratuita !== false,
          cupo: a.cupo ?? null,
          lugar: a.lugar ?? null,
          fecha: a.fecha ?? null,
          fechaFin: a.fechaFin ?? null,
          hora: a.recurrence?.hora || a.hora || null,
          cuando: cuandoEs(a),
          proximo: proximo
            ? {
                fecha: proximo.dia,
                texto: fechaCorta(proximo.dia),
                hora: proximo.hora || a.hora || null,
                aceptadas: aceptadas.length,
                enEspera: contar(lista, 'en_espera'),
                pendientes: contar(lista, 'pendiente'),
                comprobantes: lista.filter((i) => i.pago?.comprobante?.url && i.pago?.estadoPago === 'pendiente').length,
                nombres: aceptadas.slice(0, 8).map((i) => nombreDe(i.userId)).filter(Boolean),
              }
            : null,
          semana: semana.map((e) => ({
            fecha: e.dia,
            dia: (new Date(`${e.dia}T00:00:00.000Z`).getUTCDay() + 6) % 7, // 0 = lunes
            hora: e.hora || a.hora || null,
            aceptadas: contar(delEncuentro.get(`${a._id}|${e.dia}`) ?? [], 'aceptada'),
          })),
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al armar el resumen de actividades', error: error.message });
  }
};
