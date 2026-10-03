import { Router, Request, Response, NextFunction } from 'express';
import { Quiz, QuizSubmission } from '../models/Quiz.js';
import { Topic } from '../models/Topic.js';
import { ConceptLab } from '../models/ConceptLab.js';
import { Mistake } from '../models/Mistake.js';
import { RevisionSchedule } from '../models/RevisionSchedule.js';
import { authMiddleware } from '../middlewares/auth.js';
import { generateQuizForTopic } from '../services/aiQuizService.js';
import { calculateTopicMastery } from '../services/evidenceScoring.js';
import { defaultRevisionEngine } from '../services/revisionEngine.js';

export const quizRouter = Router();

quizRouter.use(authMiddleware);

// Generate Quiz for Topic
quizRouter.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { topicId, difficulty } = req.body;

    if (!topicId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Topic ID is required.' },
      });
    }

    const topic = await Topic.findOne({ _id: topicId, userId });
    if (!topic) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Topic not found.' },
      });
    }

    const conceptLab = await ConceptLab.findOne({ topicId, userId });
    const questions = await generateQuizForTopic(
      topic.name,
      conceptLab?.intuition || '',
      difficulty || 'MEDIUM'
    );

    const quiz = await Quiz.create({
      userId,
      topicId,
      difficulty: difficulty || 'MEDIUM',
      questions,
    });

    res.status(201).json({ success: true, data: { quiz } });
  } catch (err) {
    next(err);
  }
});

// Submit Quiz Answers & Ingest Evidence
quizRouter.post('/:id/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const quizId = req.params.id;
    const { answers } = req.body; // Array of { questionId, userAnswer, timeSpentSeconds }

    const quiz = await Quiz.findOne({ _id: quizId, userId });
    if (!quiz) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Quiz not found.' },
      });
    }

    let correctCount = 0;
    const evaluatedAnswers: any[] = [];
    const newMistakes: any[] = [];

    for (const q of quiz.questions) {
      const userAns = answers.find((a: any) => a.questionId === q.questionId);
      const isCorrect = userAns
        ? userAns.userAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()
        : false;

      if (isCorrect) {
        correctCount++;
      } else if (userAns) {
        // Auto-route incorrect answer to the Mistake Bank
        let rootCause = 'CONCEPTUAL_GAP';
        if (q.type === 'DEBUGGING') rootCause = 'EDGE_CASE_BLINDNESS';
        if (q.type === 'OUTPUT_PREDICTION') rootCause = 'EXECUTION_SLIP';

        const mistake = await Mistake.create({
          userId,
          topicId: quiz.topicId,
          origin: 'QUIZ',
          prompt: q.prompt,
          codeSnippet: q.codeSnippet,
          userErroneousAnswer: userAns.userAnswer,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          rootCause,
          oneLineRule: `Carefully verify ${q.type === 'DEBUGGING' ? 'bounds and edge cases' : 'underlying principles'} in ${q.prompt.substring(0, 50)}...`,
        });
        newMistakes.push(mistake);
      }

      evaluatedAnswers.push({
        questionId: q.questionId,
        userAnswer: userAns ? userAns.userAnswer : '',
        isCorrect,
        timeSpentSeconds: userAns ? userAns.timeSpentSeconds : 0,
      });
    }

    const scorePercentage = Math.round((correctCount / quiz.questions.length) * 100);

    const submission = await QuizSubmission.create({
      quizId,
      topicId: quiz.topicId,
      userId,
      answers: evaluatedAnswers,
      scorePercentage,
      evaluatedAt: new Date(),
    });

    // Update Topic Evidence
    const topic = await Topic.findOne({ _id: quiz.topicId, userId });
    let scheduledRevision = null;

    if (topic) {
      // Comprehension score update: exponential moving average
      topic.comprehensionScore = Math.round(
        topic.comprehensionScore === 0
          ? scorePercentage
          : topic.comprehensionScore * 0.4 + scorePercentage * 0.6
      );
      // Practical questions bump application score
      if (scorePercentage >= 70) {
        topic.applicationScore = Math.min(100, topic.applicationScore + 15);
      }

      const evidence = calculateTopicMastery(topic.lifecycleStatus, {
        comprehensionScore: topic.comprehensionScore,
        applicationScore: topic.applicationScore,
        retentionScore: topic.retentionScore,
        consistencyScore: topic.consistencyScore,
        stabilityDays: topic.stabilityDays,
        totalStudyMinutes: topic.totalStudyMinutes,
        revisionCycleCount: topic.revisionCycleCount,
        unresolvedMistakeCount: newMistakes.length,
      });

      if (evidence.statusChanged) {
        topic.lifecycleStatus = evidence.newStatus;
        submission.promotedState = evidence.newStatus;
        await submission.save();

        // If promoted to ASSESSED for the first time, automatically schedule Revision 1 (+2 days)
        if (evidence.newStatus === 'ASSESSED' && !topic.nextRevisionDueDate) {
          const scheduleResult = defaultRevisionEngine.calculateNextSchedule(0, topic.stabilityDays, scorePercentage);
          topic.nextRevisionDueDate = scheduleResult.nextScheduledDate;

          scheduledRevision = await RevisionSchedule.create({
            userId,
            topicId: topic._id,
            targetIntervalIndex: 1,
            scheduledDate: scheduleResult.nextScheduledDate,
            status: 'PENDING',
          });
        }
      }
      topic.masteryScore = evidence.masteryScore;
      await topic.save();
    }

    res.json({
      success: true,
      data: {
        submission,
        scorePercentage,
        correctCount,
        totalQuestions: quiz.questions.length,
        newMistakesCount: newMistakes.length,
        topicStatus: topic?.lifecycleStatus,
        masteryScore: topic?.masteryScore,
        scheduledRevision,
      },
    });
  } catch (err) {
    next(err);
  }
});
