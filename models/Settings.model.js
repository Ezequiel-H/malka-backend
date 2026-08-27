import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema(
  {
    instruccionesPagoDefault: {
      type: String,
      trim: true,
      default: '',
    },
    /* Contacto de WhatsApp del centro. El default es el número que estaba
       hardcodeado en el front, para no romper nada al migrar. */
    whatsappNumero: {
      type: String,
      trim: true,
      default: '5491134405730',
    },
    /* Mensaje prellenado que manda el PARTICIPANTE al coordinar el pago de
       un viaje. Variables: {nombre}, {actividad}, {fecha}. */
    whatsappViajeMensaje: {
      type: String,
      trim: true,
      default:
        'Hola! Soy {nombre}. Me inscribí al viaje "{actividad}" ({fecha}) y quiero coordinar el pago.',
    },
    /* Plantillas del ADMIN para escribirle a inscriptos por WhatsApp.
       Variables: {nombre}, {actividad}, {fecha}, {hora}, {lugar}, {precio}. */
    plantillasWhatsApp: [
      {
        nombre: { type: String, required: true, trim: true },
        mensaje: { type: String, required: true, trim: true },
      },
    ],
  },
  { timestamps: true }
);

settingsSchema.statics.getSettings = async function getSettings() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

const Settings = mongoose.model('Settings', settingsSchema);

export default Settings;
