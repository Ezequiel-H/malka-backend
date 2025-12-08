import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.model.js';

dotenv.config();

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/centro-cultural');
    console.log('✅ Connected to MongoDB');

    const email = process.argv[2] || 'admin@centrocultural.com';
    const password = process.argv[3] || 'admin123';
    const nombre = process.argv[4] || 'Admin';
    const apellido = process.argv[5] || 'Sistema';

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email });
    if (existingAdmin) {
      console.log('⚠️  Admin user already exists');
      process.exit(0);
    }

    // Create admin user
    const admin = new User({
      email,
      password,
      nombre,
      apellido,
      role: 'admin',
      estado: 'approved',
      onboardingCompleted: true
    });

    await admin.save();
    console.log('✅ Admin user created successfully!');
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log('\n⚠️  Remember to change the password after first login!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error);
    process.exit(1);
  }
};

createAdmin();

