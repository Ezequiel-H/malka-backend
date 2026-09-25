import Settings from '../models/Settings.model.js';

export const getSettings = async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.json({ settings });
  } catch (error) {
    console.error('Error al obtener ajustes:', error);
    res.status(500).json({ message: 'Error al obtener ajustes', error: error.message });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const {
      instruccionesPagoDefault,
      whatsappNumero,
      whatsappViajeMensaje,
      whatsappCumpleanosMensaje,
      plantillasWhatsApp,
    } = req.body;
    const settings = await Settings.getSettings();
    if (instruccionesPagoDefault !== undefined) {
      settings.instruccionesPagoDefault = instruccionesPagoDefault;
    }
    if (whatsappNumero !== undefined) {
      // Sólo dígitos: wa.me no acepta +, espacios ni guiones.
      settings.whatsappNumero = String(whatsappNumero).replace(/\D/g, '');
    }
    if (whatsappViajeMensaje !== undefined) {
      settings.whatsappViajeMensaje = whatsappViajeMensaje;
    }
    if (whatsappCumpleanosMensaje !== undefined) {
      settings.whatsappCumpleanosMensaje = whatsappCumpleanosMensaje;
    }
    if (plantillasWhatsApp !== undefined) {
      if (!Array.isArray(plantillasWhatsApp)) {
        return res.status(400).json({ message: 'plantillasWhatsApp debe ser una lista' });
      }
      const limpias = plantillasWhatsApp
        .map((p) => ({ nombre: String(p?.nombre || '').trim(), mensaje: String(p?.mensaje || '').trim() }))
        .filter((p) => p.nombre && p.mensaje);
      settings.plantillasWhatsApp = limpias;
    }
    await settings.save();
    res.json({ message: 'Ajustes actualizados', settings });
  } catch (error) {
    console.error('Error al actualizar ajustes:', error);
    res.status(500).json({ message: 'Error al actualizar ajustes', error: error.message });
  }
};
