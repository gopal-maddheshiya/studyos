import { Router, Request, Response, NextFunction } from 'express';
import { Topic } from '../models/Topic.js';
import { Subject } from '../models/Subject.js';
import { StudySession } from '../models/StudySession.js';
import { RevisionSchedule } from '../models/RevisionSchedule.js';
import { Mistake } from '../models/Mistake.js';
import { authMiddleware } from '../middlewares/auth.js';

export const analyticsRouter = Router();

analyticsRouter.use(authMiddleware);

// Get High-Signal Learning Analytics
analyticsRouter.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    const [topics, subjects, sessions, revisions, mistakes] = await Promise.all([
      Topic.find({ userId }),
      Subject.find({ userId }),
      StudySession.find({ userId }),
      RevisionSchedule.find({ userId }),
      Mistake.find({ userId }),
    ]);

    // 1. Total Active Focus Hours
    const totalFocusMinutes = sessions.reduce((acc, s) => acc + (s.activeFocusMinutes || s.durationMinutes), 0);
    const totalFocusHours = Math.round((totalFocusMinutes / 60) * 10) / 10;

    // 2. Retrieval Resilience Index (% of completed revisions with passing score)
    const completedRevisions = revisions.filter((r) => r.status === 'COMPLETED');
    const passedRevisions = completedRevisions.filter((r) => (r.performanceScore || 0) >= 60);
    const retrievalResilience = completedRevisions.length > 0
      ? Math.round((passedRevisions.length / completedRevisions.length) * 100)
      : 100;

    // 3. Topic Lifecycle Distribution
    const lifecycleCounts = {
      NOT_STARTED: topics.filter((t) => t.lifecycleStatus === 'NOT_STARTED').length,
      LEARNING: topics.filter((t) => t.lifecycleStatus === 'LEARNING').length,
      ASSESSED: topics.filter((t) => t.lifecycleStatus === 'ASSESSED').length,
      RETAINED: topics.filter((t) => t.lifecycleStatus === 'RETAINED').length,
      MASTERED: topics.filter((t) => t.lifecycleStatus === 'MASTERED').length,
    };

    // 4. Mistake Liquidation Rate
    const resolvedMistakes = mistakes.filter((m) => m.status === 'RESOLVED').length;
    const mistakeLiquidationRate = mistakes.length > 0
      ? Math.round((resolvedMistakes / mistakes.length) * 100)
      : 0;

    // 5. 1-Year Trajectory Projection
    const currentMastered = lifecycleCounts.MASTERED + lifecycleCounts.RETAINED;
    const dailyVelocity = Math.max(0.2, (lifecycleCounts.ASSESSED + currentMastered) / 30);
    const retentionFactor = retrievalResilience / 100;

    const projected1YearBaseline = Math.round(currentMastered + 365 * dailyVelocity * retentionFactor);
    const projected1YearDisciplined = Math.round(currentMastered + 365 * (dailyVelocity * 1.25) * 0.95);
    const projected1YearDecayDanger = Math.round(currentMastered + 365 * dailyVelocity * 0.4);

    res.json({
      success: true,
      data: {
        totalFocusHours,
        totalTopics: topics.length,
        retrievalResilience,
        lifecycleCounts,
        mistakeLiquidationRate,
        unresolvedMistakesCount: mistakes.filter((m) => m.status !== 'RESOLVED').length,
        trajectory: {
          currentMastered,
          projected1YearBaseline,
          projected1YearDisciplined,
          projected1YearDecayDanger,
          keyLever: 'Completing 100% of Day 2 revisions saves approximately 3.5 hours per week of re-learning forgotten concepts.',
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
