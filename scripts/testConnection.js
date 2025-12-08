import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

// Diferentes variaciones de codificación de la contraseña
const passwordVariations = [
  'gsYvJ7%3tjz!MSG&t@',  // Original
  'gsYvJ7%253tjz%21MSG%26t%40',  // Todo codificado
  'gsYvJ7%3tjz%21MSG%26t%40',  // Solo !, &, @ codificados
];

const testConnection = async (password) => {
  const uri = `mongodb+srv://sandlot8853:${password}@malka-inscripciones.l0tcuul.mongodb.net/?appName=malka-inscripciones`;
  
  try {
    const client = new MongoClient(uri);
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    console.log(`✅ SUCCESS with password: ${password.substring(0, 10)}...`);
    await client.close();
    return true;
  } catch (error) {
    console.log(`❌ Failed with password: ${password.substring(0, 10)}... - ${error.message}`);
    return false;
  }
};

console.log('Testing different password encodings...\n');

for (const password of passwordVariations) {
  const success = await testConnection(password);
  if (success) {
    console.log(`\n✅ Working connection string:`);
    console.log(`MONGODB_URI=mongodb+srv://sandlot8853:${password}@malka-inscripciones.l0tcuul.mongodb.net/?appName=malka-inscripciones`);
    process.exit(0);
  }
}

console.log('\n❌ None of the password variations worked.');
console.log('Please verify the password in MongoDB Atlas and try again.');
process.exit(1);

