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

    /* El pago de los viajes se coordina por WhatsApp: el front necesita el
       número y el mensaje prellenado (con sus variables sin resolver — las
       resuelve el cliente, que conoce al usuario). */
    if (obj.tipo === 'viaje') {
      const settings = await Settings.getSettings();
      obj.whatsappViaje = {
        numero: settings.whatsappNumero || '',
        mensaje: settings.whatsappViajeMensaje || '',
      };
    }
  }
  return obj;
}
