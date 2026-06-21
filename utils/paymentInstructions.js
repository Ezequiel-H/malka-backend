import Settings from '../models/Settings.model.js';

export async function resolveInstruccionesPago(activity) {
  if (!activity || activity.esGratuita) {
    return null;
  }
  const custom = activity.instruccionesPago?.trim();
  if (custom) {
    return custom;
  }
  const settings = await Settings.getSettings();
  return settings.instruccionesPagoDefault?.trim() || '';
}

export async function attachInstruccionesPagoResueltas(activity) {
  if (!activity) return activity;
  const obj = typeof activity.toObject === 'function' ? activity.toObject() : { ...activity };
  if (!obj.esGratuita) {
    obj.instruccionesPagoResueltas = await resolveInstruccionesPago(obj);
  }
  return obj;
}
