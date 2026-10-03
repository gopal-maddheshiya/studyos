import { Router, Request, Response, NextFunction } from 'express';
import { StudySession } from '../models/StudySession.js';
import { Topic } from '../models/Topic.js';
import { authMiddleware } from '../middlewares/auth.js';
import { calculateTopicMastery } from '../services/evidenceScoring.js';

export const sessionRouter = Router();

sessionRouter.use(authMiddleware);

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

    const session = await StudySession.create({
      userId,
      topicId,
      startTime: new Date(),
      wasPlanned: !!wasPlanned,
      timetableBlockId: timetableBlockId || null,
      heartbeatsLogged: 1,
      activeFocusMinutes: 1,
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

// Focus Heartbeat (User is actively engaged)
sessionRouter.post('/:id/heartbeat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const sessionId = req.params.id;

    const session = await StudySession.findOneAndUpdate(
      { _id: sessionId, userId, endTime: { $exists: false } },
      {
        $inc: { heartbeatsLogged: 1, activeFocusMinutes: 1 },
      },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({
        success: false,
        error: { code: 'SESSION_NOT_ACTIVE', message: 'Session not found or already completed.' },
      });
    }

    res.json({ success: true, data: { activeFocusMinutes: session.activeFocusMinutes } });
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

    const endTime = new Date();
    const durationMinutes = Math.max(
      1,
      Math.round((endTime.getTime() - session.startTime.getTime()) / (1000 * 60))
    );

    session.endTime = endTime;
    session.durationMinutes = durationMinutes;
    // Cap active focus minutes by wall clock duration
    session.activeFocusMinutes = Math.min(durationMinutes, session.activeFocusMinutes || durationMinutes);
    if (sessionNotes) session.sessionNotes = sessionNotes;
    await session.save();

    // Update Topic Evidence
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
