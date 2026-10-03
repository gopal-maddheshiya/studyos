import { Router, Request, Response, NextFunction } from 'express';
import { Subject } from '../models/Subject.js';
import { Topic } from '../models/Topic.js';
import { ConceptLab } from '../models/ConceptLab.js';
import { authMiddleware } from '../middlewares/auth.js';

export const subjectRouter = Router();

subjectRouter.use(authMiddleware);

// Get all subjects with their nested topics
subjectRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const subjects = await Subject.find({ userId }).sort({ order: 1, createdAt: 1 });
    const topics = await Topic.find({ userId }).sort({ createdAt: 1 });

    const topicsBySubject = topics.reduce((acc, topic) => {
      const subId = topic.subjectId.toString();
      if (!acc[subId]) acc[subId] = [];
      acc[subId].push(topic);
      return acc;
    }, {} as Record<string, typeof topics>);

    const payload = subjects.map((sub) => ({
      ...sub.toObject(),
      topics: topicsBySubject[sub._id.toString()] || [],
    }));

    res.json({ success: true, data: { subjects: payload } });
  } catch (err) {
    next(err);
  }
});

// Create subject
subjectRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { name, description, color, icon } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Subject name is required.' },
      });
    }

    const count = await Subject.countDocuments({ userId });
    const subject = await Subject.create({
      userId,
      name,
      description,
      color: color || '#C25E3E',
      icon: icon || 'BookOpen',
      order: count,
    });

    res.status(201).json({ success: true, data: { subject } });
  } catch (err) {
    next(err);
  }
});
