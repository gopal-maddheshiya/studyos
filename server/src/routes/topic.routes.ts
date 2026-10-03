import { Router, Request, Response, NextFunction } from 'express';
import { Topic } from '../models/Topic.js';
import { ConceptLab } from '../models/ConceptLab.js';
import { Mistake } from '../models/Mistake.js';
import { authMiddleware } from '../middlewares/auth.js';
import { calculateTopicMastery } from '../services/evidenceScoring.js';

export const topicRouter = Router();

topicRouter.use(authMiddleware);

// Create Topic & initialize Concept Lab
topicRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { subjectId, name, parentTopicId } = req.body;

    if (!subjectId || !name) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Subject ID and topic name are required.' },
      });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    const topic = await Topic.create({
      userId,
      subjectId,
      name,
      slug,
      parentTopicId: parentTopicId || null,
      lifecycleStatus: 'NOT_STARTED',
      masteryScore: 0,
      stabilityDays: 2.0,
    });

    // Initialize corresponding Concept Lab entry
    const conceptLab = await ConceptLab.create({
      userId,
      topicId: topic._id,
      intuition: `### Mental Model for ${name}\n\nStart by understanding the real-world intuition before writing a single line of code.`,
      complexity: { time: 'O(N)', space: 'O(1)', explanation: 'Baseline complexity profile.' },
      codeSnippets: [
        {
          language: 'python',
          title: 'Canonical Implementation',
          code: `# ${name} Implementation\ndef solve():\n    pass\n`,
        },
      ],
      personalNotes: `*Key takeaways and edge cases to remember:*`,
    });

    res.status(201).json({ success: true, data: { topic, conceptLab } });
  } catch (err) {
    next(err);
  }
});

// Get Topic Details with Concept Lab & Mistakes
topicRouter.get('/:id/lab', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const topicId = req.params.id;

    const topic = await Topic.findOne({ _id: topicId, userId });
    if (!topic) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Topic not found.' },
      });
    }

    let conceptLab = await ConceptLab.findOne({ topicId, userId });
    if (!conceptLab) {
      conceptLab = await ConceptLab.create({
        userId,
        topicId: topic._id,
        intuition: `Intuition for ${topic.name}`,
        complexity: { time: 'O(N)', space: 'O(1)', explanation: '' },
        codeSnippets: [],
        personalNotes: '',
      });
    }

    const mistakes = await Mistake.find({ topicId, userId }).sort({ createdAt: -1 });

    // Recompute real-time evidence score
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

    res.json({
      success: true,
      data: {
        topic,
        conceptLab,
        mistakes,
        evidence,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update Concept Lab Notes & Code
topicRouter.put('/:id/lab', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const topicId = req.params.id;
    const { intuition, complexity, codeSnippets, personalNotes, tags } = req.body;

    const updated = await ConceptLab.findOneAndUpdate(
      { topicId, userId },
      {
        $set: {
          ...(intuition !== undefined && { intuition }),
          ...(complexity !== undefined && { complexity }),
          ...(codeSnippets !== undefined && { codeSnippets }),
          ...(personalNotes !== undefined && { personalNotes }),
          ...(tags !== undefined && { tags }),
        },
      },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: { conceptLab: updated } });
  } catch (err) {
    next(err);
  }
});
