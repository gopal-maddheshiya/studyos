import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { RevisionSchedule } from '../models/RevisionSchedule.js';
import { Topic } from '../models/Topic.js';
import { ConceptLab } from '../models/ConceptLab.js';
import { Mistake } from '../models/Mistake.js';
import { User } from '../models/User.js';
import { authMiddleware } from '../middlewares/auth.js';
import { defaultRevisionEngine } from '../services/revisionEngine.js';
import { calculateTopicMastery } from '../services/evidenceScoring.js';
import {
  assembleDiagnosticChallenge,
  sanitizeDiagnosticChallenge,
  evaluateDiagnosticSubmission,
  validateDiagnosticPayload,
  validateDiagnosticSubmission,
  DiagnosticValidationError,
} from '../services/revisionDiagnosticService.js';
import { DiagnosticAnswerSubmission } from '../types/diagnostic.js';

export const revisionRouter = Router();

// Custom Domain Errors for Transaction Boundary Mapping
class RevisionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevisionConflictError';
  }
}

class RevisionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevisionNotFoundError';
  }
}

class TopicNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopicNotFoundError';
  }
}

function isTransactionUnsupportedError(err: any): boolean {
  if (!err) return false;
  if (err.code === 20 || err.codeName === 'IllegalOperation') return true;
  const msg = String(err.message || '');
  return (
    msg.includes('Transaction numbers are only allowed on a replica set member') ||
    (msg.includes('replica set') && msg.includes('transaction')) ||
    msg.includes('Transactions are not supported') ||
    msg.includes('does not support transactions')
  );
}

revisionRouter.use(authMiddleware);

// 1. Get Due and Overdue Revisions
revisionRouter.get('/due', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const now = new Date();

    const dueRevisions = await RevisionSchedule.find({
      userId,
      status: { $in: ['PENDING', 'OVERDUE'] },
      scheduledDate: { $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) }, // Due today or earlier
    })
      .populate('topicId', 'name slug lifecycleStatus masteryScore stabilityDays totalStudyMinutes')
      .sort({ scheduledDate: 1 });

    res.json({
      success: true,
      data: {
        revisions: dueRevisions,
        count: dueRevisions.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 2. Fetch or Generate Sanitized Diagnostic Challenge for Revision
revisionRouter.get('/:id/diagnostic', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const revisionId = req.params.id;

    const revision = await RevisionSchedule.findOne({ _id: revisionId, userId });
    if (!revision) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Revision schedule not found.' },
      });
    }

    if (revision.status === 'COMPLETED') {
      return res.status(409).json({
        success: false,
        error: { code: 'REVISION_ALREADY_COMPLETED', message: 'Revision has already been completed.' },
      });
    }

    const topic = await Topic.findOne({ _id: revision.topicId, userId });
    if (!topic) {
      return res.status(404).json({
        success: false,
        error: { code: 'TOPIC_NOT_FOUND', message: 'Linked topic not found.' },
      });
    }

    // If challenge questions not yet generated, assemble and save
    if (!revision.challengeQuestions || revision.challengeQuestions.length === 0) {
      const conceptLab = await ConceptLab.findOne({ topicId: topic._id, userId });
      const activeMistakes = await Mistake.find({ topicId: topic._id, userId, status: { $ne: 'RESOLVED' } }).limit(2);

      const challengeQuestions = assembleDiagnosticChallenge(topic, conceptLab, activeMistakes);
      revision.challengeQuestions = challengeQuestions;
      await revision.save();
    }

    // Deliver strictly sanitized public challenge questions (no secret keys or explanations)
    const publicQuestions = sanitizeDiagnosticChallenge(revision.challengeQuestions);

    res.json({
      success: true,
      data: {
        revisionId: revision._id,
        targetIntervalIndex: revision.targetIntervalIndex,
        topic: {
          id: topic._id,
          name: topic.name,
          slug: topic.slug,
          stabilityDays: topic.stabilityDays,
        },
        questions: publicQuestions,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 3. Submit Active Retrieval Diagnostic Challenge (Evidence-Evaluated & Transactional)
revisionRouter.post('/:id/submit', async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user!.id;
  const revisionId = req.params.id;

  // 1. Structural pre-validation of payload and rejection of forged fields before starting session
  try {
    validateDiagnosticPayload(req.body);
  } catch (err: any) {
    if (err instanceof DiagnosticValidationError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: err.message,
          timestamp: new Date().toISOString(),
        },
      });
    }
    return next(err);
  }

  const { answers } = req.body;
  const recallConfidence = req.body.recallConfidence ?? req.body.recallRating;

  let session: mongoose.ClientSession;
  try {
    session = await mongoose.startSession();
  } catch (err: any) {
    if (isTransactionUnsupportedError(err)) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'TRANSACTION_NOT_SUPPORTED',
          message: 'MongoDB deployment does not support multi-document transactions (replica set required).',
          timestamp: new Date().toISOString(),
        },
      });
    }
    return next(err);
  }

  let completionResult: any = null;

  try {
    await session.withTransaction(async () => {
      // 1. Atomic conditional compare-and-swap on PENDING/OVERDUE state inside transaction
      const revision = await RevisionSchedule.findOneAndUpdate(
        {
          _id: revisionId,
          userId,
          status: { $in: ['PENDING', 'OVERDUE'] },
        },
        {
          $set: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        },
        { new: true, session }
      );

      if (!revision) {
        const existing = await RevisionSchedule.findOne({ _id: revisionId, userId }).session(session);
        if (existing && existing.status === 'COMPLETED') {
          throw new RevisionConflictError('This revision schedule has already been completed and evaluated.');
        }
        throw new RevisionNotFoundError('Revision schedule not found.');
      }

      // 2. Validate topic ownership and existence
      const topic = await Topic.findOne({ _id: revision.topicId, userId }).session(session);
      if (!topic) {
        throw new TopicNotFoundError('Linked topic not found.');
      }

      // 3. User lookup for timezone
      const user = await User.findById(userId).session(session);
      const userTimezone = user?.timezone || 'Asia/Kolkata';

      // 4. Assemble challenge questions if missing
      if (!revision.challengeQuestions || revision.challengeQuestions.length === 0) {
        const conceptLab = await ConceptLab.findOne({ topicId: topic._id, userId }).session(session);
        const activeMistakes = await Mistake.find({ topicId: topic._id, userId, status: { $ne: 'RESOLVED' } })
          .limit(2)
          .session(session);
        revision.challengeQuestions = assembleDiagnosticChallenge(topic, conceptLab, activeMistakes);
      }

      // 5. Strictly validate submitted answers against authoritative challenge questions
      validateDiagnosticSubmission(revision.challengeQuestions, answers, req.body);

      // 6. Evaluate answers with deterministic server logic
      const evalResult = evaluateDiagnosticSubmission(
        revision.challengeQuestions,
        answers as DiagnosticAnswerSubmission[],
        topic._id
      );

      const confidenceRating = Math.min(5, Math.max(1, Number(recallConfidence) || 3));
      revision.evaluations = evalResult.evaluations;
      revision.performanceScore = evalResult.scorePercentage;
      revision.recallConfidence = confidenceRating;
      await revision.save({ session });

      // 6. Auto-create mistakes in Mistake Vault for incorrect responses
      if (evalResult.mistakesToCreate.length > 0) {
        await Mistake.insertMany(
          evalResult.mistakesToCreate.map((m) => ({ ...m, userId })),
          { session }
        );
      }

      // 7. Calculate next schedule using Rule247RevisionEngine
      const scheduleResult = defaultRevisionEngine.calculateNextSchedule(
        revision.targetIntervalIndex,
        topic.revisionCycleCount,
        topic.stabilityDays,
        evalResult.isPassing,
        confidenceRating,
        userTimezone
      );

      // Update topic retention & memory stability
      topic.stabilityDays = scheduleResult.newStabilityDays;
      topic.lastRevisedAt = new Date();
      topic.revisionCycleCount += scheduleResult.cycleCountIncrement;
      topic.nextRevisionDueDate = scheduleResult.nextScheduledDate;

      // Exponential moving average for retention score
      topic.retentionScore = Math.round(
        topic.retentionScore === 0
          ? evalResult.scorePercentage
          : topic.retentionScore * 0.3 + evalResult.scorePercentage * 0.7
      );

      // Recompute topic evidence & lifecycle status
      const topicMistakes = await Mistake.find({ topicId: topic._id, userId }).session(session);
      const evidence = calculateTopicMastery(topic.lifecycleStatus, {
        comprehensionScore: topic.comprehensionScore,
        applicationScore: topic.applicationScore,
        retentionScore: topic.retentionScore,
        consistencyScore: topic.consistencyScore,
        stabilityDays: topic.stabilityDays,
        totalStudyMinutes: topic.totalStudyMinutes,
        revisionCycleCount: topic.revisionCycleCount,
        unresolvedMistakeCount: topicMistakes.filter((m) => m.status !== 'RESOLVED').length,
      });

      if (evidence.statusChanged) {
        topic.lifecycleStatus = evidence.newStatus;
      }
      topic.masteryScore = evidence.masteryScore;
      topic.decayRisk = evidence.decayRisk;
      await topic.save({ session });

      // 8. Schedule next revision entry if not already present
      let nextRevision = await RevisionSchedule.findOne({
        userId,
        topicId: topic._id,
        status: { $in: ['PENDING', 'OVERDUE'] },
      }).session(session);

      if (!nextRevision) {
        const created = await RevisionSchedule.create(
          [
            {
              userId,
              topicId: topic._id,
              targetIntervalIndex: scheduleResult.nextIntervalIndex,
              scheduledDate: scheduleResult.nextScheduledDate,
              status: 'PENDING',
              previousRevisionId: revision._id,
            },
          ],
          { session }
        );
        nextRevision = created[0];
      }

      completionResult = {
        completedRevision: revision,
        evaluations: evalResult.evaluations,
        correctCount: evalResult.correctCount,
        totalQuestions: evalResult.totalQuestions,
        isPassing: evalResult.isPassing,
        scorePercentage: evalResult.scorePercentage,
        nextRevision,
        topicStatus: topic.lifecycleStatus,
        masteryScore: topic.masteryScore,
        stabilityDays: topic.stabilityDays,
        nextIntervalDays: scheduleResult.nextIntervalDays,
        nextIntervalIndex: scheduleResult.nextIntervalIndex,
      };
    });

    return res.json({
      success: true,
      data: completionResult,
    });
  } catch (err: any) {
    if (err instanceof DiagnosticValidationError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: err.message,
          timestamp: new Date().toISOString(),
        },
      });
    }
    if (err instanceof RevisionConflictError) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'REVISION_ALREADY_COMPLETED',
          message: err.message,
          timestamp: new Date().toISOString(),
        },
      });
    }
    if (err instanceof RevisionNotFoundError) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: err.message,
          timestamp: new Date().toISOString(),
        },
      });
    }
    if (err instanceof TopicNotFoundError) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TOPIC_NOT_FOUND',
          message: err.message,
          timestamp: new Date().toISOString(),
        },
      });
    }
    if (isTransactionUnsupportedError(err)) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'TRANSACTION_NOT_SUPPORTED',
          message: 'MongoDB deployment does not support multi-document transactions (replica set required).',
          timestamp: new Date().toISOString(),
        },
      });
    }
    next(err);
  } finally {
    await session.endSession();
  }
});
