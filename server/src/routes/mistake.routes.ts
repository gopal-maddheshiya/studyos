import { Router, Request, Response, NextFunction } from 'express';
import { Mistake } from '../models/Mistake.js';
import { authMiddleware } from '../middlewares/auth.js';

export const mistakeRouter = Router();

mistakeRouter.use(authMiddleware);

// Get All Mistakes with filtering
mistakeRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { topicId, rootCause, status } = req.query;

    const filter: any = { userId };
    if (topicId) filter.topicId = topicId;
    if (rootCause) filter.rootCause = rootCause;
    if (status) filter.status = status;

    const mistakes = await Mistake.find(filter)
      .populate('topicId', 'name slug lifecycleStatus')
      .sort({ createdAt: -1 });

    const stats = {
      total: mistakes.length,
      active: mistakes.filter((m) => m.status === 'ACTIVE').length,
      probation: mistakes.filter((m) => m.status === 'PROBATION').length,
      resolved: mistakes.filter((m) => m.status === 'RESOLVED').length,
    };

    res.json({ success: true, data: { mistakes, stats } });
  } catch (err) {
    next(err);
  }
});

// Record a Manual Mistake
mistakeRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const {
      topicId,
      origin,
      prompt,
      codeSnippet,
      userErroneousAnswer,
      correctAnswer,
      explanation,
      rootCause,
      oneLineRule,
    } = req.body;

    if (!topicId || !prompt || !correctAnswer || !rootCause || !oneLineRule) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Missing required mistake fields.' },
      });
    }

    const mistake = await Mistake.create({
      userId,
      topicId,
      origin: origin || 'PRACTICE',
      prompt,
      codeSnippet,
      userErroneousAnswer: userErroneousAnswer || '',
      correctAnswer,
      explanation: explanation || '',
      rootCause,
      oneLineRule,
      recurrenceCount: 1,
      status: 'ACTIVE',
    });

    res.status(201).json({ success: true, data: { mistake } });
  } catch (err) {
    next(err);
  }
});

// Re-Test / Drill Mistake
mistakeRouter.post('/:id/drill', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const mistakeId = req.params.id;
    const { passed } = req.body; // boolean

    const mistake = await Mistake.findOne({ _id: mistakeId, userId });
    if (!mistake) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Mistake not found.' },
      });
    }

    mistake.lastTestedAt = new Date();

    if (passed) {
      mistake.consecutivePasses += 1;
      if (mistake.consecutivePasses >= 2) {
        mistake.status = 'RESOLVED';
      } else {
        mistake.status = 'PROBATION';
      }
    } else {
      mistake.consecutivePasses = 0;
      mistake.recurrenceCount += 1;
      mistake.status = 'ACTIVE';
    }

    await mistake.save();

    res.json({
      success: true,
      data: {
        mistake,
        isResolved: mistake.status === 'RESOLVED',
        consecutivePasses: mistake.consecutivePasses,
      },
    });
  } catch (err) {
    next(err);
  }
});
