import { Router, Request, Response, NextFunction } from 'express';
import { TimetableRoutine } from '../models/TimetableRoutine.js';
import { ScheduledStudyBlock } from '../models/ScheduledStudyBlock.js';
import { Topic } from '../models/Topic.js';
import { Subject } from '../models/Subject.js';
import { RevisionSchedule } from '../models/RevisionSchedule.js';
import { authMiddleware } from '../middlewares/auth.js';

export const timetableRouter = Router();

timetableRouter.use(authMiddleware);

// Get Weekly Routine Templates
timetableRouter.get('/routines', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    let routines = await TimetableRoutine.find({ userId }).sort({ dayOfWeek: 1 });

    // Seed default template if user has none
    if (routines.length === 0) {
      const defaultWeek = [
        {
          dayOfWeek: 1, // Monday
          blocks: [
            { blockId: 'b_m1', name: 'Morning DSA & Algorithmic Practice', startTime: '07:00', endTime: '09:30', blockType: 'STUDY' },
            { blockId: 'b_m2', name: 'Evening Systems & Development', startTime: '18:00', endTime: '20:30', blockType: 'PROJECT' },
          ],
        },
        {
          dayOfWeek: 2, // Tuesday
          blocks: [
            { blockId: 'b_t1', name: 'Morning DSA & Spaced Recall', startTime: '07:00', endTime: '09:30', blockType: 'REVISION' },
            { blockId: 'b_t2', name: 'Evening Systems & Development', startTime: '18:00', endTime: '20:30', blockType: 'PROJECT' },
          ],
        },
        {
          dayOfWeek: 3, // Wednesday
          blocks: [
            { blockId: 'b_w1', name: 'Morning DSA & Concept Deep Dive', startTime: '07:00', endTime: '09:30', blockType: 'STUDY' },
            { blockId: 'b_w2', name: 'Evening Systems & Development', startTime: '18:00', endTime: '20:30', blockType: 'PROJECT' },
          ],
        },
        {
          dayOfWeek: 4, // Thursday
          blocks: [
            { blockId: 'b_th1', name: 'Morning DSA & Spaced Recall', startTime: '07:00', endTime: '09:30', blockType: 'REVISION' },
            { blockId: 'b_th2', name: 'Evening Systems & Development', startTime: '18:00', endTime: '20:30', blockType: 'PROJECT' },
          ],
        },
        {
          dayOfWeek: 5, // Friday
          blocks: [
            { blockId: 'b_f1', name: 'Morning DSA Problem Solving', startTime: '07:00', endTime: '09:30', blockType: 'STUDY' },
            { blockId: 'b_f2', name: 'Evening Systems & Development', startTime: '18:00', endTime: '20:30', blockType: 'PROJECT' },
          ],
        },
        {
          dayOfWeek: 6, // Saturday
          blocks: [
            { blockId: 'b_sa1', name: 'Core Project Development Sprint', startTime: '10:00', endTime: '15:00', blockType: 'PROJECT' },
          ],
        },
        {
          dayOfWeek: 0, // Sunday
          blocks: [
            { blockId: 'b_su1', name: 'Weekly Contest & Upsolving Hub', startTime: '10:00', endTime: '13:00', blockType: 'CONTEST' },
            { blockId: 'b_su2', name: 'Mistake Bank Clearance & Review', startTime: '17:00', endTime: '19:00', blockType: 'REVISION' },
          ],
        },
      ];

      await TimetableRoutine.insertMany(
        defaultWeek.map((d) => ({ ...d, userId }))
      );
      routines = await TimetableRoutine.find({ userId }).sort({ dayOfWeek: 1 });
    }

    res.json({ success: true, data: { routines } });
  } catch (err) {
    next(err);
  }
});

// Update Weekly Routine Block for a Day
timetableRouter.put('/routines/:dayOfWeek', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const dayOfWeek = Number(req.params.dayOfWeek);
    const { blocks } = req.body;

    // Verify all referenced targetSubjectIds belong to authenticated user
    if (Array.isArray(blocks)) {
      const subjectIds = blocks.map((b: any) => b.targetSubjectId).filter(Boolean);
      if (subjectIds.length > 0) {
        const uniqueSubjectIds = [...new Set(subjectIds)];
        const ownedCount = await Subject.countDocuments({ _id: { $in: uniqueSubjectIds }, userId });
        if (ownedCount !== uniqueSubjectIds.length) {
          return res.status(404).json({
            success: false,
            error: {
              code: 'SUBJECT_NOT_FOUND',
              message: 'One or more referenced subjects do not exist.',
            },
          });
        }
      }
    }

    const routine = await TimetableRoutine.findOneAndUpdate(
      { userId, dayOfWeek },
      { $set: { blocks } },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: { routine } });
  } catch (err) {
    next(err);
  }
});

// Get Dynamic Daily Plan ("What should I study today?")
timetableRouter.get('/daily', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const todayStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const todayDate = new Date(todayStr);
    const dayOfWeek = todayDate.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;

    // 1. Fetch any already scheduled blocks for today
    let dailyBlocks = await ScheduledStudyBlock.find({ userId, date: todayStr })
      .populate('allocatedTopicId', 'name slug lifecycleStatus masteryScore')
      .populate('allocatedSubjectId', 'name color icon');

    // 2. If no blocks are generated yet for today, dynamically compile from routine & priority backlog
    if (dailyBlocks.length === 0) {
      const routine = await TimetableRoutine.findOne({ userId, dayOfWeek });
      const routineBlocks = routine?.blocks || [];

      // Fetch pending revisions & high-priority topics
      const pendingRevisions = await RevisionSchedule.find({
        userId,
        status: { $in: ['PENDING', 'OVERDUE'] },
      }).populate('topicId');

      const learningTopics = await Topic.find({
        userId,
        lifecycleStatus: { $in: ['LEARNING', 'NOT_STARTED'] },
      }).sort({ lifecycleStatus: 1, updatedAt: -1 });

      const newBlocks: any[] = [];
      let revIndex = 0;
      let topicIndex = 0;

      for (const rb of routineBlocks) {
        let allocatedTopicId: any = null;
        let blockType: any = rb.blockType;

        if (rb.blockType === 'REVISION' && pendingRevisions[revIndex]) {
          allocatedTopicId = pendingRevisions[revIndex].topicId?._id;
          revIndex++;
        } else if (rb.blockType === 'STUDY' && learningTopics[topicIndex]) {
          allocatedTopicId = learningTopics[topicIndex]._id;
          topicIndex++;
        }

        const [startH, startM] = rb.startTime.split(':').map(Number);
        const [endH, endM] = rb.endTime.split(':').map(Number);
        const plannedMinutes = (endH * 60 + endM) - (startH * 60 + startM);

        newBlocks.push({
          userId,
          date: todayStr,
          routineBlockId: rb.blockId,
          name: rb.name,
          startTime: rb.startTime,
          endTime: rb.endTime,
          allocatedTopicId,
          allocatedSubjectId: rb.targetSubjectId || null,
          type: blockType,
          plannedMinutes: Math.max(30, plannedMinutes),
          status: 'SCHEDULED',
        });
      }

      if (newBlocks.length > 0) {
        await ScheduledStudyBlock.insertMany(newBlocks);
        dailyBlocks = await ScheduledStudyBlock.find({ userId, date: todayStr })
          .populate('allocatedTopicId', 'name slug lifecycleStatus masteryScore')
          .populate('allocatedSubjectId', 'name color icon');
      }
    }

    // 3. Check for missed blocks from previous days that were not completed
    const missedBlocks = await ScheduledStudyBlock.find({
      userId,
      date: { $lt: todayStr },
      status: 'SCHEDULED',
    }).populate('allocatedTopicId', 'name slug');

    // 4. Compute Plan vs Reality for today
    const totalPlannedMinutes = dailyBlocks.reduce((acc, b) => acc + b.plannedMinutes, 0);
    const totalActualMinutes = dailyBlocks.reduce((acc, b) => acc + b.activeFocusMinutes, 0);

    res.json({
      success: true,
      data: {
        date: todayStr,
        dayOfWeek,
        blocks: dailyBlocks,
        missedBlocks,
        planVsReality: {
          plannedMinutes: totalPlannedMinutes,
          actualMinutes: totalActualMinutes,
          adherenceRatio: totalPlannedMinutes > 0 ? Math.round((totalActualMinutes / totalPlannedMinutes) * 100) : 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update/Reschedule a block
timetableRouter.patch('/blocks/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const blockId = req.params.id;
    const { status, rescheduledToDate } = req.body;

    // Client is strictly forbidden from manually manipulating study durations
    const block = await ScheduledStudyBlock.findOneAndUpdate(
      { _id: blockId, userId },
      {
        $set: {
          ...(status && { status }),
          ...(rescheduledToDate && { rescheduledToDate }),
        },
      },
      { new: true }
    );

    if (!block) {
      return res.status(404).json({
        success: false,
        error: { code: 'STUDY_BLOCK_NOT_FOUND', message: 'Scheduled study block not found.' },
      });
    }

    res.json({ success: true, data: { block } });
  } catch (err) {
    next(err);
  }
});
