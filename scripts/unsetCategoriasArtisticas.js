import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.model.js';

dotenv.config();

const main = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/centro-cultural';
  await mongoose.connect(uri);
  console.log(`✅ Conectado a MongoDB (db: ${mongoose.connection.db.databaseName})`);

  const result = await User.updateMany(
    { categoriasArtisticas: { $exists: true } },
    { $unset: { categoriasArtisticas: '' } }
  );

  console.log(`   Coincidencias: ${result.matchedCount}, documentos modificados: ${result.modifiedCount}`);

  await mongoose.disconnect();
  console.log('✅ Listo.');
};

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
