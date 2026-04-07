import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.model.js';
import Activity from '../models/Activity.model.js';
import Inscription from '../models/Inscription.model.js';
import Tag from '../models/Tag.model.js';

dotenv.config();

const models = [
  { label: 'User', model: User },
  { label: 'Activity', model: Activity },
  { label: 'Inscription', model: Inscription },
  { label: 'Tag', model: Tag },
];

const main = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/centro-cultural';
  await mongoose.connect(uri);
  const dbName = mongoose.connection.db.databaseName;
  console.log(`✅ Conectado a MongoDB (db: ${dbName})`);

  for (const { label, model } of models) {
    const collName = model.collection.name;
    const existing = await mongoose.connection.db
      .listCollections({ name: collName })
      .toArray();

    if (existing.length === 0) {
      await model.createCollection();
      console.log(`   Colección creada: ${collName} (${label})`);
    } else {
      console.log(`   Colección ya existía: ${collName} (${label})`);
    }

    await model.syncIndexes();
    console.log(`   Índices sincronizados: ${collName}`);
  }

  await mongoose.disconnect();
  console.log('✅ Listo.');
};

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
