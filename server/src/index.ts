import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';

import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { errorHandler } from './middlewares/errorHandler.js';

import { authRouter } from './routes/auth.routes.js';
import { subjectRouter } from './routes/subject.routes.js';
import { topicRouter } from './routes/topic.routes.js';
import { sessionRouter } from './routes/session.routes.js';
import { quizRouter } from './routes/quiz.routes.js';
import { revisionRouter } from './routes/revision.routes.js';
import { timetableRouter } from './routes/timetable.routes.js';
import { mistakeRouter } from './routes/mistake.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { seedRouter } from './routes/seed.routes.js';

const app = express();

// Security & Parsing Middlewares
app.use(helmet({ contentSecurityPolicy: false })); // Permissive in dev mode for Vite assets
app.use(
  cors({
    origin: [env.CLIENT_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'],
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(mongoSanitize());

// Global Rate Limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' },
  },
});
app.use('/api/', globalLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    product: 'StudyOS Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/subjects', subjectRouter);
app.use('/api/v1/topics', topicRouter);
app.use('/api/v1/sessions', sessionRouter);
app.use('/api/v1/quizzes', quizRouter);
app.use('/api/v1/revisions', revisionRouter);
app.use('/api/v1/timetable', timetableRouter);
app.use('/api/v1/mistakes', mistakeRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/seed', seedRouter);

// Centralized Error Handling
app.use(errorHandler);

// Start Server
async function bootstrap() {
  await connectDB();
  const PORT = Number(env.PORT) || 5000;
  app.listen(PORT, () => {
    console.log(`[StudyOS Server] Running in ${env.NODE_ENV} mode on http://localhost:${PORT}`);
    console.log(`[StudyOS Server] Client Origin set to: ${env.CLIENT_ORIGIN}`);
  });
}

bootstrap().catch((err) => {
  console.error('[StudyOS Server] Fatal Bootstrap Error:', err);
});
