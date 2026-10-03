import { Router, Request, Response, NextFunction } from 'express';
import { RevisionSchedule } from '../models/RevisionSchedule.js';
import { Topic } from '../models/Topic.js';
import { ConceptLab } from '../models/ConceptLab.js';
import { Mistake } from '../models/Mistake.js';
import { authMiddleware } from '../middlewares/auth.js';
import { defaultRevisionEngine } from '../services/revisionEngine.js';
import { calculateTopicMastery } from '../services/evidenceScoring.js';

export const revisionRouter = Router();

revisionRouter.use(authMiddleware);

// Get Due and Overdue Revisions
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

// Submit Active Recall Revision Session
revisionRouter.post('/:id/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const revisionId = req.params.id;
    const { performanceScore, recallRating, notes } = req.body; // performanceScore 0-100, recallRating 1-5

    const revision = await RevisionSchedule.findOne({ _id: revisionId, userId });
    if (!revision) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Revision schedule not found.' },
      });
    }

    const topic = await Topic.findOne({ _id: revision.topicId, userId });
    if (!topic) {
      return res.status(404).json({
        success: false,
        error: { code: 'TOPIC_NOT_FOUND', message: 'Linked topic not found.' },
      });
    }

    const score = Number(performanceScore);
    const rating = Math.min(5, Math.max(1, Number(recallRating) || 3));

    // Calculate next schedule using 2-4-7 engine
    const scheduleResult = defaultRevisionEngine.calculateNextSchedule(
      topic.revisionCycleCount,
      topic.stabilityDays,
      score,
      rating
    );

    // Update revision record
    revision.status = 'COMPLETED';
    revision.completedAt = new Date();
    revision.performanceScore = score;
    revision.recallRating = rating;
    await revision.save();

    // Update topic retention & stability
    topic.stabilityDays = scheduleResult.newStabilityDays;
    topic.lastRevisedAt = new Date();
    topic.revisionCycleCount += scheduleResult.cycleCountIncrement;
    topic.nextRevisionDueDate = scheduleResult.nextScheduledDate;

    // Moving average for retention score
    topic.retentionScore = Math.round(
      topic.retentionScore === 0 ? score : topic.retentionScore * 0.3 + score * 0.7
    );

    // Recompute evidence & lifecycle
    const mistakes = await Mistake.find({ topicId: topic._id, userId });
    const evidence = calculateTopicMastery(topic.lifecycleStatus, {
      comprehensionScore: topic.comprehensionScore,
      applicationScore: topic.applicationScore,
      retentionScore: topic.retentionScore,
      consistencyScore: topic.consistencyScore,
      stabilityDays: topic.stabilityDays,
      totalStudyMinutes: topic.totalStudyMinutes,
      revisionCycleCount: topic.revisionCycleCount,
      unresolvedMistakeCount: mistakes.filter((m) => m.status !== 'RESOLVED').length,
    });

    if (evidence.statusChanged) {
      topic.lifecycleStatus = evidence.newStatus;
    }
    topic.masteryScore = evidence.masteryScore;
    topic.decayRisk = evidence.decayRisk;
    await topic.save();

    // Schedule the next revision entry
    const nextRevision = await RevisionSchedule.create({
      userId,
      topicId: topic._id,
      targetIntervalIndex: revision.targetIntervalIndex + 1,
      scheduledDate: scheduleResult.nextScheduledDate,
      status: 'PENDING',
    });

    res.json({
      success: true,
      data: {
        completedRevision: revision,
        nextRevision,
        topicStatus: topic.lifecycleStatus,
        masteryScore: topic.masteryScore,
        stabilityDays: topic.stabilityDays,
        nextIntervalDays: scheduleResult.nextIntervalDays,
      },
    });
  } catch (err) {
    next(err);
  }
});
