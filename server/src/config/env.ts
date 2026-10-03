import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/studyos'),
  JWT_SECRET: z.string().default('studyos_super_secret_jwt_key_for_dev_mode_change_in_prod'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_SECRET: z.string().default('studyos_super_secret_refresh_token_for_dev'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  OPENAI_API_KEY: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
