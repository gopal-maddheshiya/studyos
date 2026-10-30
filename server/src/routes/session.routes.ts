import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { StudySession } from '../models/StudySession.js';
import { Topic } from '../models/Topic.js';
import { ScheduledStudyBlock } from '../models/ScheduledStudyBlock.js';
import { authMiddleware } from '../middlewares/auth.js';
import { calculateTopicMastery } from '../services/evidenceScoring.js';

export const sessionRouter = Router();

sessionRouter.use(authMiddleware);

// Temporal accounting constants
const MIN_HEARTBEAT_INTERVAL_SECONDS = 50;
const MAX_ALLOWED_GAP_SECONDS = 900; // 15 minutes abandonment threshold
const MAX_CREDITABLE_GAP_SECONDS = 120; // Bounded single heartbeat credit
const MAX_SESSION_SECONDS = 14400; // 4 hours limit

// Rate limit on heartbeat endpoint: max 2 requests per 50 seconds
const heartbeatLimiter = rateLimit({
  windowMs: 50 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many heartbeat requests. Maximum 2 per 50 seconds.',
    },
  },
});

// Start a Study Session
sessionRouter.post('/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { topicId, wasPlanned, timetableBlockId } = req.body;

    if (!topicId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Topic ID is required to start a session.' },
      });
    }

    // 1. Verify Topic belongs to authenticated user
    const topic = await Topic.findOne({ _id: topicId, userId });
    if (!topic) {
      return res.status(404).json({
        success: false,
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found.' },
      });
    }

    // 2. If timetableBlockId supplied, verify it belongs to authenticated user
    if (timetableBlockId) {
      const block = await ScheduledStudyBlock.findOne({ _id: timetableBlockId, userId });
      if (!block) {
        return res.status(404).json({
          success: false,
          error: { code: 'STUDY_BLOCK_NOT_FOUND', message: 'Scheduled study block not found.' },
        });
      }
    }

    const now = new Date();
    const session = await StudySession.create({
      userId,
      topicId,
      startTime: now,
      lastHeartbeatAt: now,
      status: 'ACTIVE',
      wasPlanned: !!wasPlanned,
      timetableBlockId: timetableBlockId || null,
      heartbeatsLogged: 0,
      activeFocusMinutes: 0,
      verifiedActiveSeconds: 0,
    });

    res.status(201).json({
      success: true,
      data: {
        sessionId: session._id,
        heartbeatIntervalSeconds: 60,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Focus Heartbeat (True server-side elapsed-time accounting)
sessionRouter.post('/:id/heartbeat', heartbeatLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const sessionId = req.params.id;

    const session = await StudySession.findOne({ _id: sessionId, userId });
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Study session not found.' },
      });
    }

    if (session.status === 'COMPLETED') {
      return res.status(409).json({
        success: false,
        error: { code: 'SESSION_ALREADY_COMPLETED', message: 'Study session is already completed.' },
      });
    }

    if (session.status === 'ABANDONED') {
      return res.status(409).json({
        success: false,
        error: { code: 'SESSION_ABANDONED', message: 'Study session was marked abandoned due to inactivity.' },
      });
    }

    const now = new Date();
    const deltaSeconds = Math.round((now.getTime() - session.lastHeartbeatAt.getTime()) / 1000);

    // 1. Inactivity & Abandonment check
    if (deltaSeconds > MAX_ALLOWED_GAP_SECONDS) {
      session.status = 'ABANDONED';
      await session.save();
      return res.status(400).json({
        success: false,
        error: {
          code: 'SESSION_ABANDONED',
          message: 'Session abandoned due to inactivity (>15 min). Inactive gap was not credited.',
        },
      });
    }

    // 2. Rapid request rejection (Anti-Spam / loop detection)
    if (deltaSeconds < MIN_HEARTBEAT_INTERVAL_SECONDS) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'HEARTBEAT_TOO_FREQUENT',
          message: `Heartbeat received too soon (${deltaSeconds}s elapsed). Minimum interval is ${MIN_HEARTBEAT_INTERVAL_SECONDS} seconds.`,
        },
      });
    }

    // 3. Bounded Elapsed-Time Crediting
    const creditableDelta = Math.min(deltaSeconds, MAX_CREDITABLE_GAP_SECONDS);
    const remainingLifetime = Math.max(0, MAX_SESSION_SECONDS - session.verifiedActiveSeconds);
    const creditedSeconds = Math.min(creditableDelta, remainingLifetime);

    session.verifiedActiveSeconds += creditedSeconds;
    session.activeFocusMinutes = Math.floor(session.verifiedActiveSeconds / 60);
    session.lastHeartbeatAt = now;
    session.heartbeatsLogged += 1; // Strictly telemetry

    if (session.verifiedActiveSeconds >= MAX_SESSION_SECONDS) {
      session.status = 'COMPLETED';
    }

    await session.save();

    res.json({
      success: true,
      data: {
        verifiedActiveSeconds: session.verifiedActiveSeconds,
        activeFocusMinutes: session.activeFocusMinutes,
        creditedSeconds,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Finish Study Session
sessionRouter.post('/:id/finish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const sessionId = req.params.id;
    const { sessionNotes } = req.body;

    const session = await StudySession.findOne({ _id: sessionId, userId });
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found.' },
      });
    }

    if (session.status === 'COMPLETED') {
      return res.status(409).json({
        success: false,
        error: { code: 'SESSION_ALREADY_COMPLETED', message: 'Session is already finished.' },
      });
    }

    const endTime = new Date();
    const wallClockSeconds = Math.max(0, Math.round((endTime.getTime() - session.startTime.getTime()) / 1000));
    const durationMinutes = Math.max(1, Math.round(wallClockSeconds / 60));

    // Authoritative study time derived from verifiedActiveSeconds, bounded by wall clock and max session duration
    session.verifiedActiveSeconds = Math.min(session.verifiedActiveSeconds, wallClockSeconds, MAX_SESSION_SECONDS);
    session.activeFocusMinutes = Math.round(session.verifiedActiveSeconds / 60);
    session.durationMinutes = durationMinutes;
    session.endTime = endTime;
    session.status = 'COMPLETED';
    if (sessionNotes) session.sessionNotes = sessionNotes;
    await session.save();

    // Update Topic Evidence using verified session active focus minutes
    const topic = await Topic.findOne({ _id: session.topicId, userId });
    let promptQuiz = false;
    let promotedToLearning = false;

    if (topic) {
      topic.totalStudyMinutes += session.activeFocusMinutes;
      topic.lastStudiedAt = endTime;
      // Increment consistency score proportionally (100 pts per 120 mins)
      topic.consistencyScore = Math.min(100, Math.round((topic.totalStudyMinutes / 120) * 100));

      const evidence = calculateTopicMastery(topic.lifecycleStatus, {
        comprehensionScore: topic.comprehensionScore,
        applicationScore: topic.applicationScore,
        retentionScore: topic.retentionScore,
        consistencyScore: topic.consistencyScore,
        stabilityDays: topic.stabilityDays,
        totalStudyMinutes: topic.totalStudyMinutes,
        revisionCycleCount: topic.revisionCycleCount,
        unresolvedMistakeCount: 0,
      });

      if (evidence.statusChanged) {
        topic.lifecycleStatus = evidence.newStatus;
        if (evidence.newStatus === 'LEARNING') promotedToLearning = true;
      }
      topic.masteryScore = evidence.masteryScore;
      await topic.save();

      // If user studied >= 15 mins, recommend diagnostic quiz
      if (session.activeFocusMinutes >= 15 || topic.lifecycleStatus === 'LEARNING') {
        promptQuiz = true;
      }
    }

    res.json({
      success: true,
      data: {
        session,
        promptQuiz,
        promotedToLearning,
        topicStatus: topic?.lifecycleStatus,
        masteryScore: topic?.masteryScore,
      },
    });
  } catch (err) {
    next(err);
  }
});
