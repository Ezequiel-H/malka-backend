import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Import routes
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import activityRoutes from './routes/activity.routes.js';
import inscriptionRoutes from './routes/inscription.routes.js';
import tagRoutes from './routes/tag.routes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/inscriptions', inscriptionRoutes);
app.use('/api/tags', tagRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Function to check what process is using the port
const checkPortProcess = async (port) => {
  try {
    // Get detailed info about the process using the port
    const { stdout } = await execAsync(`lsof -i:${port} -P -n | grep LISTEN`);
    
    if (stdout.trim()) {
      // Parse the output to get process info
      const lines = stdout.trim().split('\n');
      const pids = [];
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[1];
        if (pid && !pids.includes(pid)) {
          pids.push(pid);
        }
      }
      
      console.log(`\n⚠️  Port ${port} is currently in use by:`);
      
      // Get detailed info for each PID
      for (const pid of pids) {
        try {
          // Get full command with arguments
          const { stdout: psOutput } = await execAsync(`ps -p ${pid} -o pid,command,etime,cwd -ww`);
          const psLines = psOutput.trim().split('\n');
          
          if (psLines.length > 1) {
            const header = psLines[0];
            const data = psLines[1].trim();
            
            // Parse the ps output
            const parts = data.split(/\s+/);
            const commandIndex = header.indexOf('COMMAND');
            const command = data.substring(commandIndex).trim();
            
            console.log(`\n   📋 Process Details (PID: ${pid}):`);
            console.log(`   ──────────────────────────────────────`);
            console.log(`   Command: ${command}`);
            
            // Try to get working directory
            try {
              const { stdout: cwdOutput } = await execAsync(`lsof -p ${pid} -a -d cwd -Fn | grep ^n | cut -c2-`);
              const cwd = cwdOutput.trim();
              if (cwd) {
                console.log(`   Working Directory: ${cwd}`);
              }
            } catch (e) {
              // Ignore if we can't get cwd
            }
            
            // Get elapsed time
            try {
              const { stdout: etimeOutput } = await execAsync(`ps -p ${pid} -o etime=`);
              const etime = etimeOutput.trim();
              if (etime) {
                console.log(`   Running for: ${etime}`);
              }
            } catch (e) {
              // Ignore if we can't get etime
            }
          }
        } catch (psError) {
          // If ps fails, just show basic info from lsof
          const parts = line.trim().split(/\s+/);
          console.log(`   Process: ${parts[0]} (PID: ${parts[1]}, User: ${parts[2]})`);
        }
      }
      
      console.log(`\n💡 To free the port, run:`);
      console.log(`   lsof -ti:${port} | xargs kill -9`);
      console.log(`   Or change the PORT in your .env file\n`);
      
      return true;
    }
    return false;
  } catch (error) {
    // Port is not in use or lsof didn't find anything
    return false;
  }
};

// Function to start server with retry logic
const startServer = async (port, retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
          console.log(`🚀 Server running on port ${port}`);
          resolve(server);
        });

        server.on('error', async (err) => {
          if (err.code === 'EADDRINUSE') {
            // Close the server instance that failed
            server.close();
            
            // Show what process is using the port
            await checkPortProcess(port);
            
            if (attempt < retries - 1) {
              // This will be handled by the catch block
              reject(new Error('RETRY'));
            } else {
              console.error(`❌ Port ${port} is already in use after ${retries} attempts`);
              reject(err);
            }
          } else {
            console.error('❌ Server error:', err);
            reject(err);
          }
        });
      });
    } catch (error) {
      if (error.message === 'RETRY' && attempt < retries - 1) {
        console.log(`⚠️  Waiting 3 seconds before retry... (${attempt + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue; // Retry
      }
      throw error;
    }
  }
  
  // If we get here, all retries failed
  throw new Error(`Failed to start server on port ${port} after ${retries} attempts`);
};

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/centro-cultural';
    
    const connectionOptions = {
      serverSelectionTimeoutMS: 10000, // 10 seconds
      socketTimeoutMS: 45000, // 45 seconds
      connectTimeoutMS: 10000, // 10 seconds
      retryWrites: true,
      retryReads: true,
      maxPoolSize: 10,
    };

    await mongoose.connect(mongoURI, connectionOptions);
    console.log('✅ Connected to MongoDB');
    
    const PORT = process.env.PORT || 5001;
    await startServer(PORT);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      // Port error already handled in startServer
      process.exit(1);
    } else {
      console.error('❌ MongoDB connection error:', error);
      console.error('\n💡 Troubleshooting tips:');
      console.error('1. Check your internet connection');
      console.error('2. Verify MONGODB_URI in .env file');
      console.error('3. Check MongoDB Atlas IP whitelist settings');
      console.error('4. Verify DNS resolution is working');
      console.error('5. Try using the standard connection string format instead of SRV');
      process.exit(1);
    }
  }
};

// Handle connection events
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

// Start connection
connectDB();

export default app;

