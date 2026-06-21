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
    const { instruccionesPagoDefault } = req.body;
    const settings = await Settings.getSettings();
    if (instruccionesPagoDefault !== undefined) {
      settings.instruccionesPagoDefault = instruccionesPagoDefault;
    }
    await settings.save();
    res.json({ message: 'Ajustes actualizados', settings });
  } catch (error) {
    console.error('Error al actualizar ajustes:', error);
    res.status(500).json({ message: 'Error al actualizar ajustes', error: error.message });
  }
};
