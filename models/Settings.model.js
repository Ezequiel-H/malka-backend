import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema(
  {
    instruccionesPagoDefault: {
      type: String,
      trim: true,
      default: '',
    },
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
