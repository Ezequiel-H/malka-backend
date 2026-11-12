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
    /* Mensaje prellenado que manda quien se registra y NO vive en Buenos
       Aires, para terminar el registro por WhatsApp. Variables: {nombre},
       {ciudad}. */
    whatsappRegistroMensaje: {
      type: String,
      trim: true,
      default:
        'Hola! Soy {nombre}, me acabo de registrar en Malka y vivo en {ciudad}. ¿Qué más necesitan para terminar mi registro?',
    },
    /* Saludo de cumpleaños que el ADMIN manda desde el panel.
       Variables: {nombre}, {edad}. El default es sobrio a propósito: es un
       mensaje que sale a nombre de la casa, y el admin lo edita a su gusto. */
    whatsappCumpleanosMensaje: {
      type: String,
      trim: true,
      default: '¡Feliz cumpleaños, {nombre}! Te abrazamos fuerte desde Malka. 🎂',
    },
    /* Plantillas del ADMIN para escribirle a inscriptos por WhatsApp.
       Variables: {nombre}, {actividad}, {fecha}, {hora}, {lugar}, {precio}. */
    /* Último día (YYYY-MM-DD, hora argentina) en que salió el recordatorio
       push de actividades del día. Lo usa el job para no repetirlo. */
    ultimoRecordatorioPush: {
      type: String,
      default: null,
    },
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
