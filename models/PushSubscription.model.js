import mongoose from 'mongoose';

/**
 * Un dispositivo (navegador o app instalada) que aceptó recibir
 * notificaciones. Una persona puede tener varios; el `endpoint` identifica
 * al dispositivo y es único.
 */
const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    endpoint: {
      type: String,
      required: true,
      unique: true
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true }
    },
    userAgent: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

export default PushSubscription;
