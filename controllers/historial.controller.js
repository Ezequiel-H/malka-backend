import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import User from '../models/User.model.js';
import Contacto from '../models/Contacto.model.js';
import Visita, { ORIGENES_VISITA } from '../models/Visita.model.js';
import Activity from '../models/Activity.model.js';
import Inscription from '../models/Inscription.model.js';
import { limitesDias } from '../utils/metricas.js';
import { esHojaDeGastos, idEvento, leerFecha, leerFilas, leerGastos, normalizar, planificarGastos, planificarImportacion } from '../utils/historial.js';
import Gasto from '../models/Gasto.model.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const esId = (v) => mongoose.Types.ObjectId.isValid(v);
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nombreDe = (p) => [p?.nombre, p?.apellido].filter(Boolean).join(' ') || 'Sin nombre';

/* ---------------- Personas ---------------- */

/**
 * GET /api/historial/personas?q=… — para sumar a alguien al historial o a
 * una actividad: busca entre las cuentas y los contactos a la vez.
 */
export const buscarPersonas = async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ personas: [] });
    const partes = q.split(/\s+/).map((p) => new RegExp(escapar(p), 'i'));
    const filtro = { $and: partes.map((r) => ({ $or: [{ nombre: r }, { apellido: r }, { email: r }, { dni: r }] })) };
    const [usuarios, contactos] = await Promise.all([
      User.find({ ...filtro, role: 'participant' }).select('nombre apellido email telefono').limit(8).lean(),
      Contacto.find({ $and: partes.map((r) => ({ $or: [{ nombre: r }, { apellido: r }, { email: r }] })), usuarioId: null })
        .select('nombre apellido email telefono')
        .limit(8)
        .lean(),
    ]);
    res.json({
      personas: [
        ...usuarios.map((u) => ({ tipo: 'usuario', id: String(u._id), nombre: nombreDe(u), email: u.email, telefono: u.telefono })),
        ...contactos.map((c) => ({ tipo: 'contacto', id: String(c._id), nombre: nombreDe(c), email: c.email, telefono: c.telefono })),
      ],
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al buscar personas', error: error.message });
  }
};

const CAMPOS_CONTACTO = ['nombre', 'apellido', 'email', 'telefono', 'fechaNacimiento', 'notas'];
const leerContacto = (body) => {
  const datos = {};
  for (const c of CAMPOS_CONTACTO) if (c in body) datos[c] = body[c] === '' || body[c] === null ? undefined : String(body[c]).trim();
  if (datos.fechaNacimiento) datos.fechaNacimiento = leerFecha(datos.fechaNacimiento) ?? 'invalida';
  return datos;
};
const validarContacto = (d, parcial) => {
  if ((!parcial || 'nombre' in d) && !d.nombre) return 'El nombre es requerido';
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return 'Mail inválido';
  if (d.fechaNacimiento === 'invalida') return 'Fecha de nacimiento inválida';
  return null;
};

/**
 * POST /api/historial/contactos — alta rápida de alguien sin cuenta. Si el
 * mail ya es de una cuenta o de otro contacto, no lo duplica: devuelve ese.
 */
export const crearContacto = async (req, res) => {
  try {
    const datos = leerContacto(req.body);
    const error = validarContacto(datos, false);
    if (error) return res.status(400).json({ message: error });
    if (datos.email) {
      const usuario = await User.findOne({ email: datos.email.toLowerCase() }).select('nombre apellido email').lean();
      if (usuario) return res.status(200).json({ persona: { tipo: 'usuario', id: String(usuario._id), nombre: nombreDe(usuario), email: usuario.email }, existia: true });
      const contacto = await Contacto.findOne({ email: datos.email.toLowerCase() }).lean();
      if (contacto) return res.status(200).json({ persona: { tipo: 'contacto', id: String(contacto._id), nombre: nombreDe(contacto), email: contacto.email }, existia: true });
    }
    const contacto = await Contacto.create({ ...datos, origen: req.body.origen === 'sin_anotarse' ? 'sin_anotarse' : 'manual', creadoPor: req.user._id });
    res.status(201).json({ persona: { tipo: 'contacto', id: String(contacto._id), nombre: nombreDe(contacto), email: contacto.email } });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear el contacto', error: error.message });
  }
};

export const verContacto = async (req, res) => {
  try {
    if (!esId(req.params.id)) return res.status(404).json({ message: 'Contacto no encontrado' });
    const contacto = await Contacto.findById(req.params.id).lean();
    if (!contacto) return res.status(404).json({ message: 'Contacto no encontrado' });
    res.json({ contacto });
  } catch (error) {
    res.status(500).json({ message: 'Error al buscar el contacto', error: error.message });
  }
};

export const editarContacto = async (req, res) => {
  try {
    if (!esId(req.params.id)) return res.status(404).json({ message: 'Contacto no encontrado' });
    const contacto = await Contacto.findById(req.params.id);
    if (!contacto) return res.status(404).json({ message: 'Contacto no encontrado' });
    const datos = leerContacto(req.body);
    const error = validarContacto(datos, true);
    if (error) return res.status(400).json({ message: error });
    for (const [k, v] of Object.entries(datos)) contacto.set(k, v);
    await contacto.save();
    res.json({ contacto });
  } catch (error) {
    res.status(500).json({ message: 'Error al editar el contacto', error: error.message });
  }
};

/** DELETE /api/historial/contactos/:id — borra el contacto y sus visitas. */
export const borrarContacto = async (req, res) => {
  try {
    if (!esId(req.params.id)) return res.status(404).json({ message: 'Contacto no encontrado' });
    const contacto = await Contacto.findByIdAndDelete(req.params.id);
    if (!contacto) return res.status(404).json({ message: 'Contacto no encontrado' });
    const { deletedCount } = await Visita.deleteMany({ contactoId: contacto._id });
    res.json({ message: 'Contacto borrado', visitasBorradas: deletedCount });
  } catch (error) {
    res.status(500).json({ message: 'Error al borrar el contacto', error: error.message });
  }
};

/* ---------------- El historial ---------------- */

/**
 * GET /api/historial?from&to&q&origen&actividad&page — todo lo que pasó: las
 * inscripciones aceptadas a las que la persona vino y las visitas (sin
 * anotarse, a mano, importadas), en una sola lista de la más nueva a la más
 * vieja. `origen` filtra por cómo llegó cada fila: inscripcion, sin_anotarse,
 * manual o importado (varios separados por coma).
 */
export const listarHistorial = async (req, res) => {
  try {
    const { from, to } = req.query;
    if ((from || to) && (!DATE_RE.test(from ?? '') || !DATE_RE.test(to ?? ''))) {
      return res.status(400).json({ message: 'from y to van juntos, en formato YYYY-MM-DD' });
    }
    const rango = from ? limitesDias(from, to) : null;
    const hoy = new Date();
    const fechaFiltro = rango ? { $gte: rango.inicio, $lte: rango.fin < hoy ? rango.fin : hoy } : { $lte: hoy };
    const origenes = String(req.query.origen ?? '').split(',').filter(Boolean);
    const quiere = (o) => !origenes.length || origenes.includes(o);
    const actividad = String(req.query.actividad ?? '');

    const filtroActividad = esId(actividad) ? { activityId: actividad } : {};
    const [inscripciones, visitas] = await Promise.all([
      quiere('inscripcion') && !actividad.startsWith('ev:')
        ? Inscription.find({ estado: 'aceptada', asistencia: { $ne: 'falto' }, fecha: fechaFiltro, ...filtroActividad }).select('userId activityId fecha asistencia').lean()
        : [],
      Visita.find({
        fecha: fechaFiltro,
        ...(origenes.length ? { origen: { $in: origenes.filter((o) => ORIGENES_VISITA.includes(o)) } } : {}),
        ...(esId(actividad) ? { actividadId: actividad } : {}),
      }).lean(),
    ]);
    const visitasFiltradas = actividad.startsWith('ev:') ? visitas.filter((v) => v.evento && idEvento(v.evento) === actividad) : visitas;

    const idsUsuarios = new Set([...inscripciones.map((i) => String(i.userId)), ...visitasFiltradas.filter((v) => v.userId).map((v) => String(v.userId))]);
    const idsContactos = new Set(visitasFiltradas.filter((v) => v.contactoId).map((v) => String(v.contactoId)));
    const idsActividades = new Set([...inscripciones.map((i) => String(i.activityId)), ...visitasFiltradas.filter((v) => v.actividadId).map((v) => String(v.actividadId))]);
    const [usuarios, contactos, actividades] = await Promise.all([
      User.find({ _id: { $in: [...idsUsuarios] } }).select('nombre apellido email').lean(),
      Contacto.find({ _id: { $in: [...idsContactos] } }).select('nombre apellido email usuarioId').lean(),
      Activity.find({ _id: { $in: [...idsActividades] } }).select('titulo categorias').lean(),
    ]);
    const usuarioPorId = new Map(usuarios.map((u) => [String(u._id), u]));
    const contactoPorId = new Map(contactos.map((c) => [String(c._id), c]));
    const actividadPorId = new Map(actividades.map((a) => [String(a._id), a]));

    let filas = [
      ...inscripciones.map((i) => {
        const u = usuarioPorId.get(String(i.userId));
        const a = actividadPorId.get(String(i.activityId));
        return {
          id: `i:${i._id}`,
          editable: false,
          origen: 'inscripcion',
          fecha: i.fecha,
          persona: { tipo: 'usuario', id: String(i.userId), nombre: nombreDe(u), email: u?.email },
          encuentro: { actividadId: String(i.activityId), titulo: a?.titulo ?? 'Actividad eliminada', categorias: a?.categorias ?? [] },
          confirmada: i.asistencia === 'vino',
        };
      }),
      ...visitasFiltradas.map((v) => {
        const persona = v.userId
          ? { tipo: 'usuario', id: String(v.userId), ...(() => { const u = usuarioPorId.get(String(v.userId)); return { nombre: nombreDe(u), email: u?.email }; })() }
          : { tipo: 'contacto', id: String(v.contactoId), ...(() => { const c = contactoPorId.get(String(v.contactoId)); return { nombre: nombreDe(c), email: c?.email }; })() };
        const a = v.actividadId ? actividadPorId.get(String(v.actividadId)) : null;
        return {
          id: String(v._id),
          editable: true,
          origen: v.origen,
          fecha: v.fecha,
          persona,
          encuentro: v.actividadId
            ? { actividadId: String(v.actividadId), titulo: a?.titulo ?? 'Actividad eliminada', categorias: a?.categorias ?? [] }
            : { evento: v.evento, titulo: v.evento, categorias: [v.categoria, v.subcategoria].filter(Boolean) },
          categoria: v.categoria ?? null,
          subcategoria: v.subcategoria ?? null,
          notas: v.notas ?? null,
          confirmada: true,
        };
      }),
    ];

    const q = normalizar(req.query.q ?? '');
    if (q) {
      const partes = q.split(' ');
      filas = filas.filter((f) => {
        const texto = normalizar(`${f.persona.nombre} ${f.persona.email ?? ''} ${f.encuentro.titulo}`);
        return partes.every((p) => texto.includes(p));
      });
    }
    filas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    const porPagina = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const pagina = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const personas = new Set(filas.map((f) => `${f.persona.tipo}:${f.persona.id}`));
    res.json({
      total: filas.length,
      personas: personas.size,
      porOrigen: Object.fromEntries(['inscripcion', ...ORIGENES_VISITA].map((o) => [o, filas.filter((f) => f.origen === o).length])),
      pagina,
      porPagina,
      filas: filas.slice((pagina - 1) * porPagina, pagina * porPagina),
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al armar el historial', error: error.message });
  }
};

/* Valida y arma una visita a partir del cuerpo de la request. */
const leerVisita = async (body, { parcial = false } = {}) => {
  const datos = {};
  if (!parcial || body.persona) {
    const { tipo, id } = body.persona ?? {};
    if (!['usuario', 'contacto'].includes(tipo) || !esId(id)) return { error: 'Elegí a la persona' };
    const existe = tipo === 'usuario' ? await User.exists({ _id: id }) : await Contacto.exists({ _id: id });
    if (!existe) return { error: 'La persona no existe' };
    datos.userId = tipo === 'usuario' ? id : undefined;
    datos.contactoId = tipo === 'contacto' ? id : undefined;
  }
  if (!parcial || 'fecha' in body) {
    const fecha = leerFecha(body.fecha);
    if (!fecha) return { error: 'Fecha inválida' };
    datos.fecha = new Date(`${fecha}T00:00:00.000Z`);
  }
  if (!parcial || 'actividadId' in body || 'evento' in body) {
    if (body.actividadId) {
      if (!esId(body.actividadId) || !(await Activity.exists({ _id: body.actividadId }))) return { error: 'La actividad no existe' };
      datos.actividadId = body.actividadId;
      datos.evento = undefined;
    } else if (String(body.evento ?? '').trim()) {
      datos.evento = String(body.evento).trim();
      datos.actividadId = undefined;
    } else {
      return { error: 'Elegí la actividad o escribí el evento' };
    }
  }
  for (const c of ['categoria', 'subcategoria', 'notas']) if (c in body) datos[c] = String(body[c] ?? '').trim() || undefined;
  if ('origen' in body) {
    if (!['sin_anotarse', 'manual'].includes(body.origen)) return { error: 'Origen inválido' };
    datos.origen = body.origen;
  }
  return { datos };
};

/**
 * POST /api/historial — sumar una visita: alguien que vino a una actividad
 * sin anotarse (origen sin_anotarse) o a un evento cargado a mano. No deja
 * cargar dos veces a la misma persona en el mismo encuentro.
 */
export const crearVisita = async (req, res) => {
  try {
    const { datos, error } = await leerVisita(req.body);
    if (error) return res.status(400).json({ message: error });
    const dia = { $gte: datos.fecha, $lt: new Date(datos.fecha.getTime() + 86400000) };
    if (datos.actividadId && datos.userId) {
      const inscripta = await Inscription.exists({ userId: datos.userId, activityId: datos.actividadId, fecha: dia, estado: 'aceptada' });
      if (inscripta) return res.status(409).json({ message: 'Ya estaba inscripta a ese encuentro: marcá su asistencia en la lista' });
    }
    const repetida = await Visita.exists({
      ...(datos.userId ? { userId: datos.userId } : { contactoId: datos.contactoId }),
      ...(datos.actividadId ? { actividadId: datos.actividadId } : { evento: datos.evento }),
      fecha: dia,
    });
    if (repetida) return res.status(409).json({ message: 'Esa persona ya está cargada en ese encuentro' });
    const visita = await Visita.create({ ...datos, origen: datos.origen ?? (datos.actividadId ? 'sin_anotarse' : 'manual'), creadoPor: req.user._id });
    res.status(201).json({ message: 'Visita cargada', visita });
  } catch (error) {
    res.status(500).json({ message: 'Error al cargar la visita', error: error.message });
  }
};

export const editarVisita = async (req, res) => {
  try {
    if (!esId(req.params.id)) return res.status(404).json({ message: 'Visita no encontrada' });
    const visita = await Visita.findById(req.params.id);
    if (!visita) return res.status(404).json({ message: 'Visita no encontrada' });
    const { datos, error } = await leerVisita(req.body, { parcial: true });
    if (error) return res.status(400).json({ message: error });
    for (const [k, v] of Object.entries(datos)) visita.set(k, v);
    await visita.save();
    res.json({ message: 'Visita actualizada', visita });
  } catch (error) {
    res.status(500).json({ message: 'Error al editar la visita', error: error.message });
  }
};

export const borrarVisita = async (req, res) => {
  try {
    if (!esId(req.params.id)) return res.status(404).json({ message: 'Visita no encontrada' });
    const visita = await Visita.findByIdAndDelete(req.params.id);
    if (!visita) return res.status(404).json({ message: 'Visita no encontrada' });
    res.json({ message: 'Visita borrada' });
  } catch (error) {
    res.status(500).json({ message: 'Error al borrar la visita', error: error.message });
  }
};

/* ---------------- Importar la planilla ---------------- */

/* Una planilla (xlsx o csv) a encabezados + filas, de la hoja que más se
   parezca a un listado de asistencias (la que tenga Evento y Fecha). */
const leerPlanilla = async (archivo) => {
  const libro = new ExcelJS.Workbook();
  const esCsv = /\.csv$/i.test(archivo.originalname) || archivo.mimetype === 'text/csv';
  if (esCsv) {
    const { Readable } = await import('node:stream');
    await libro.csv.read(Readable.from(archivo.buffer.toString('utf8').replace(/^﻿/, '')));
  } else {
    await libro.xlsx.load(archivo.buffer);
  }
  const hojas = libro.worksheets.map((hoja) => {
    const filas = [];
    hoja.eachRow({ includeEmpty: false }, (fila) => {
      const valores = fila.values.slice(1).map((v) => (v && typeof v === 'object' && 'result' in v ? v.result : v));
      filas.push(valores);
    });
    return { nombre: hoja.name, encabezados: (filas[0] ?? []).map((h) => String(h ?? '')), filas: filas.slice(1) };
  });
  const deAsistencias = (h) => {
    const n = h.encabezados.map(normalizar);
    return n.includes('evento') && n.includes('fecha') && !esHojaDeGastos(h.encabezados);
  };
  return {
    asistencias: hojas.find(deAsistencias) ?? null,
    gastos: hojas.find((h) => esHojaDeGastos(h.encabezados)) ?? null,
  };
};

/**
 * POST /api/historial/importar (multipart: archivo; confirmar=si)
 * Sin confirmar devuelve qué haría; con confirmar=si lo hace. Reconoce a las
 * personas que ya están (por mail, o por nombre y apellido), crea contactos
 * para las nuevas y no repite visitas ya cargadas, así se puede importar la
 * planilla actualizada las veces que haga falta.
 */
export const importarPlanilla = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Subí la planilla (xlsx o csv)' });
    let libro;
    try {
      libro = await leerPlanilla(req.file);
    } catch {
      return res.status(400).json({ message: 'No se pudo leer la planilla. ¿Es un xlsx o un csv?' });
    }
    if (!libro.asistencias?.filas.length && !libro.gastos?.filas.length) {
      return res.status(400).json({ message: 'No encontré una hoja con Evento y Fecha (asistencias) ni una con Concepto, Monto y Fecha (gastos)' });
    }

    const filas = libro.asistencias ? leerFilas(libro.asistencias.encabezados, libro.asistencias.filas) : [];
    const [usuarios, contactos, visitas, gastosExistentes] = await Promise.all([
      User.find({ role: 'participant' }).select('nombre apellido email').lean(),
      Contacto.find().select('nombre apellido email usuarioId').lean(),
      Visita.find({ origen: 'importado' }).select('userId contactoId evento actividadId fecha').lean(),
      Gasto.find({ origen: 'importado' }).select('evento fecha tipo monto').lean(),
    ]);
    const plan = planificarImportacion({ filas, usuarios, contactos, visitas });
    const gastos = libro.gastos ? planificarGastos({ filas: leerGastos(libro.gastos.encabezados, libro.gastos.filas), existentes: gastosExistentes }) : { nuevos: [], salteados: [] };
    const salteadas = [...plan.salteadas, ...gastos.salteados];
    const resumen = {
      hojas: [libro.asistencias?.nombre, libro.gastos?.nombre].filter(Boolean),
      filas: plan.filas,
      contactosNuevos: plan.contactosNuevos.length,
      visitasNuevas: plan.visitasNuevas.length,
      reconocidas: plan.reconocidas,
      gastosNuevos: gastos.nuevos.filter((g) => g.tipo === 'gasto').length,
      ingresosNuevos: gastos.nuevos.filter((g) => g.tipo === 'ingreso').length,
      salteadas: salteadas.length,
      motivosSalteadas: Object.entries(salteadas.reduce((acc, x) => ({ ...acc, [x.motivo]: (acc[x.motivo] ?? 0) + 1 }), {})).map(
        ([motivo, cantidad]) => ({ motivo, cantidad })
      ),
      eventos: new Set(plan.visitasNuevas.map((v) => `${normalizar(v.evento)}|${v.fecha}`)).size,
      desde: plan.visitasNuevas.reduce((m, v) => (!m || v.fecha < m ? v.fecha : m), null),
      hasta: plan.visitasNuevas.reduce((m, v) => (!m || v.fecha > m ? v.fecha : m), null),
    };
    if (req.body.confirmar !== 'si') return res.json({ confirmado: false, resumen });

    const creados = await Contacto.insertMany(
      plan.contactosNuevos.map(({ clave: _clave, ...c }) => ({ ...c, origen: 'importado', creadoPor: req.user._id }))
    );
    const idPorClave = new Map(plan.contactosNuevos.map((c, i) => [c.clave, String(creados[i]._id)]));
    await Visita.insertMany(
      plan.visitasNuevas.map((v) => ({
        userId: v.persona.tipo === 'usuario' ? v.persona.id : undefined,
        contactoId: v.persona.tipo === 'contacto' ? v.persona.id : v.persona.tipo === 'nuevo' ? idPorClave.get(v.persona.id) : undefined,
        evento: v.evento,
        fecha: new Date(`${v.fecha}T00:00:00.000Z`),
        categoria: v.categoria,
        subcategoria: v.subcategoria,
        origen: 'importado',
        creadoPor: req.user._id,
      }))
    );
    await Gasto.insertMany(
      gastos.nuevos.map((g) => ({
        fecha: new Date(`${g.fecha}T00:00:00.000Z`),
        concepto: g.concepto,
        categoria: 'otros',
        monto: g.monto,
        moneda: 'ARS',
        tipo: g.tipo,
        evento: g.evento || undefined,
        notas: g.categoria ? `Categoría en la planilla: ${g.categoria}` : undefined,
        origen: 'importado',
        creadoPor: req.user._id,
      }))
    );
    res.json({ confirmado: true, resumen });
  } catch (error) {
    res.status(500).json({ message: 'Error al importar la planilla', error: error.message });
  }
};
