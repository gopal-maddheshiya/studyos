import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB(): Promise<void> {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 3000,
    });
    console.log(`[StudyOS DB] MongoDB successfully connected to ${mongoose.connection.host}`);
  } catch (error) {
    console.error('[StudyOS DB] MongoDB connection failure:', error);
    // Don't crash immediately in dev mode to allow graceful degradation/mocking if local Mongo is starting
    if (env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}
