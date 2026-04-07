import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

import app from './app.js';

dotenv.config();

const execAsync = promisify(exec);

const checkPortProcess = async (port) => {
  try {
    const { stdout } = await execAsync(`lsof -i:${port} -P -n | grep LISTEN`);

    if (stdout.trim()) {
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

      for (const pid of pids) {
        try {
          const { stdout: psOutput } = await execAsync(`ps -p ${pid} -o pid,command,etime,cwd -ww`);
          const psLines = psOutput.trim().split('\n');

          if (psLines.length > 1) {
            const header = psLines[0];
            const data = psLines[1].trim();
            const commandIndex = header.indexOf('COMMAND');
            const command = data.substring(commandIndex).trim();

            console.log(`\n   📋 Process Details (PID: ${pid}):`);
            console.log(`   ──────────────────────────────────────`);
            console.log(`   Command: ${command}`);

            try {
              const { stdout: cwdOutput } = await execAsync(`lsof -p ${pid} -a -d cwd -Fn | grep ^n | cut -c2-`);
              const cwd = cwdOutput.trim();
              if (cwd) {
                console.log(`   Working Directory: ${cwd}`);
              }
            } catch (e) {
              // Ignore
            }

            try {
              const { stdout: etimeOutput } = await execAsync(`ps -p ${pid} -o etime=`);
              const etime = etimeOutput.trim();
              if (etime) {
                console.log(`   Running for: ${etime}`);
              }
            } catch (e) {
              // Ignore
            }
          }
        } catch (psError) {
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
    return false;
  }
};

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
            server.close();
            await checkPortProcess(port);

            if (attempt < retries - 1) {
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
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to start server on port ${port} after ${retries} attempts`);
};

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/centro-cultural';

    const connectionOptions = {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
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

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

connectDB();

export default app;
