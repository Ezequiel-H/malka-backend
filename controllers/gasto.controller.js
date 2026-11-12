import mongoose from 'mongoose';
import Gasto, { CATEGORIAS_GASTO } from '../models/Gasto.model.js';
import Activity from '../models/Activity.model.js';
import { limitesDias } from '../utils/metricas.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CAMPOS = ['fecha', 'concepto', 'categoria', 'monto', 'moneda', 'cantidad', 'unidad', 'actividadId', 'evento', 'tipo', 'notas'];

/* Lo que llega del formulario, limpio: vacíos a undefined y números como números. */
const leerCuerpo = (body) => {
  const datos = {};
  for (const campo of CAMPOS) {
    if (!(campo in body)) continue;
    const valor = body[campo];
    datos[campo] = valor === '' || valor === null ? undefined : valor;
  }
  if (datos.monto !== undefined) datos.monto = Number(datos.monto);
  if (datos.cantidad !== undefined) datos.cantidad = Number(datos.cantidad);
  return datos;
};

const validar = async (datos, { parcial = false } = {}) => {
  if (!parcial || 'fecha' in datos) {
    if (!datos.fecha || Number.isNaN(new Date(datos.fecha).getTime())) return 'Fecha inválida';
  }
  if (!parcial || 'concepto' in datos) {
    if (!datos.concepto || !String(datos.concepto).trim()) return 'El concepto es requerido';
  }
  if (!parcial || 'monto' in datos) {
    if (!Number.isFinite(datos.monto) || datos.monto < 0) return 'Monto inválido';
  }
  if (datos.cantidad !== undefined && (!Number.isFinite(datos.cantidad) || datos.cantidad < 0)) {
    return 'Cantidad inválida';
  }
  if (datos.categoria !== undefined && !CATEGORIAS_GASTO.includes(datos.categoria)) return 'Categoría inválida';
  if (datos.moneda !== undefined && !['ARS', 'USD'].includes(datos.moneda)) return 'Moneda inválida';
  if (datos.tipo !== undefined && !['gasto', 'ingreso'].includes(datos.tipo)) return 'Tipo inválido';
  if (datos.actividadId !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(datos.actividadId)) return 'Actividad inválida';
    if (!(await Activity.exists({ _id: datos.actividadId }))) return 'La actividad no existe';
  }
  return null;
};

const conActividad = (consulta) => consulta.populate('actividadId', 'titulo').populate('creadoPor', 'nombre apellido');

/** GET /api/gastos?from=YYYY-MM-DD&to=YYYY-MM-DD&actividadId=…&categoria=… */
export const listGastos = async (req, res) => {
  try {
    const { from, to, actividadId, categoria, tipo } = req.query;
    const filtro = {};
    if (from || to) {
      if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
        return res.status(400).json({ message: 'from y to van juntos, en formato YYYY-MM-DD' });
      }
      const { inicio, fin } = limitesDias(from, to);
      filtro.fecha = { $gte: inicio, $lte: fin };
    }
    if (actividadId) {
      if (!mongoose.Types.ObjectId.isValid(actividadId)) return res.status(400).json({ message: 'Actividad inválida' });
      filtro.actividadId = actividadId;
    }
    if (tipo === 'gasto') filtro.tipo = { $ne: 'ingreso' };
    else if (tipo === 'ingreso') filtro.tipo = 'ingreso';
    if (categoria) {
      const categorias = String(categoria).split(',').filter((c) => CATEGORIAS_GASTO.includes(c));
      if (categorias.length) filtro.categoria = { $in: categorias };
    }
    const gastos = await conActividad(Gasto.find(filtro).sort({ fecha: -1, createdAt: -1 }));
    res.json({ gastos, categorias: CATEGORIAS_GASTO });
  } catch (error) {
    res.status(500).json({ message: 'Error al listar los gastos', error: error.message });
  }
};

export const getGasto = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: 'Gasto no encontrado' });
    const gasto = await conActividad(Gasto.findById(req.params.id));
    if (!gasto) return res.status(404).json({ message: 'Gasto no encontrado' });
    res.json({ gasto });
  } catch (error) {
    res.status(500).json({ message: 'Error al buscar el gasto', error: error.message });
  }
};

export const createGasto = async (req, res) => {
  try {
    const datos = leerCuerpo(req.body);
    const error = await validar(datos);
    if (error) return res.status(400).json({ message: error });
    const gasto = await Gasto.create({ ...datos, creadoPor: req.user._id });
    res.status(201).json({ message: 'Gasto cargado', gasto: await conActividad(Gasto.findById(gasto._id)) });
  } catch (error) {
    res.status(500).json({ message: 'Error al cargar el gasto', error: error.message });
  }
};

export const updateGasto = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: 'Gasto no encontrado' });
    const gasto = await Gasto.findById(req.params.id);
    if (!gasto) return res.status(404).json({ message: 'Gasto no encontrado' });
    const datos = leerCuerpo(req.body);
    const error = await validar(datos, { parcial: true });
    if (error) return res.status(400).json({ message: error });
    for (const [campo, valor] of Object.entries(datos)) gasto.set(campo, valor);
    await gasto.save();
    res.json({ message: 'Gasto actualizado', gasto: await conActividad(Gasto.findById(gasto._id)) });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar el gasto', error: error.message });
  }
};

export const deleteGasto = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: 'Gasto no encontrado' });
    const gasto = await Gasto.findByIdAndDelete(req.params.id);
    if (!gasto) return res.status(404).json({ message: 'Gasto no encontrado' });
    res.json({ message: 'Gasto borrado' });
  } catch (error) {
    res.status(500).json({ message: 'Error al borrar el gasto', error: error.message });
  }
};
