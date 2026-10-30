export type TopicLifecycleStatus = 'NOT_STARTED' | 'LEARNING' | 'ASSESSED' | 'RETAINED' | 'MASTERED';

export interface ITopic {
  _id: string;
  subjectId: string;
  name: string;
  slug: string;
  lifecycleStatus: TopicLifecycleStatus;
  masteryScore: number;
  comprehensionScore: number;
  applicationScore: number;
  retentionScore: number;
  consistencyScore: number;
  stabilityDays: number;
  totalStudyMinutes: number;
  revisionCycleCount: number;
  nextRevisionDueDate?: string;
  decayRisk: boolean;
  lastStudiedAt?: string;
  lastRevisedAt?: string;
}

export interface ISubject {
  _id: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  order: number;
  topics: ITopic[];
}

export interface IConceptLab {
  _id: string;
  topicId: string;
  intuition: string;
  complexity: {
    time: string;
    space: string;
    explanation: string;
  };
  codeSnippets: Array<{
    language: string;
    title: string;
    code: string;
  }>;
  personalNotes: string;
  tags: string[];
}

export interface IQuestion {
  questionId: string;
  type: 'MCQ' | 'OUTPUT_PREDICTION' | 'DEBUGGING' | 'CONCEPTUAL' | 'CODING';
  prompt: string;
  codeSnippet?: string;
  options?: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  // Educational data available strictly post-submission:
  correctAnswer?: string;
  explanation?: string;
  distractorExplanations?: Record<string, string>;
}

export interface IEvaluatedAnswer {
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
  distractorExplanations?: Record<string, string>;
}

export interface IQuiz {
  _id: string;
  topicId: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  questions: IQuestion[];
}

export interface IRevisionSchedule {
  _id: string;
  topicId: {
    _id: string;
    name: string;
    slug: string;
    lifecycleStatus: TopicLifecycleStatus;
    masteryScore: number;
    stabilityDays: number;
  };
  targetIntervalIndex: number;
  scheduledDate: string;
  status: 'PENDING' | 'OVERDUE' | 'COMPLETED' | 'MISSED';
}

export interface IScheduledStudyBlock {
  _id: string;
  date: string;
  name: string;
  startTime: string;
  endTime: string;
  type: 'LEARNING' | 'REVISION' | 'EXAM_PREP' | 'PROJECT';
  plannedMinutes: number;
  actualMinutesLogged: number;
  activeFocusMinutes: number;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'RESCHEDULED';
  allocatedTopicId?: {
    _id: string;
    name: string;
    slug: string;
    lifecycleStatus: TopicLifecycleStatus;
  };
}

export interface IMistake {
  _id: string;
  topicId: {
    _id: string;
    name: string;
    slug: string;
  };
  origin: string;
  prompt: string;
  codeSnippet?: string;
  userErroneousAnswer: string;
  correctAnswer: string;
  explanation: string;
  rootCause: string;
  oneLineRule: string;
  recurrenceCount: number;
  status: 'ACTIVE' | 'PROBATION' | 'RESOLVED';
  consecutivePasses: number;
}

export type DiagnosticQuestionType =
  | 'MCQ'
  | 'TRUE_FALSE'
  | 'OUTPUT_PREDICTION'
  | 'COMPLEXITY'
  | 'DEBUGGING'
  | 'STRUCTURED_CONCEPTUAL';

export type CanonicalComplexity =
  | 'O(1)'
  | 'O(log N)'
  | 'O(N)'
  | 'O(N log N)'
  | 'O(N^2)'
  | 'O(2^N)'
  | 'O(N!)';

export const CANONICAL_COMPLEXITIES: CanonicalComplexity[] = [
  'O(1)',
  'O(log N)',
  'O(N)',
  'O(N log N)',
  'O(N^2)',
  'O(2^N)',
  'O(N!)',
];

export interface IPublicDiagnosticQuestion {
  questionId: string;
  type: DiagnosticQuestionType;
  prompt: string;
  codeSnippet?: string;
  options?: Array<{ optionId: string; text: string }>;
  normalization?: string;
  targetMetric?: string;
  debuggingOptions?: Array<{ fixId: string; description: string }>;
  assertions?: Array<{ assertionId: string; text: string }>;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  buggyCode?: string;
}

export type DiagnosticAnswerSubmission =
  | { questionId: string; type: 'MCQ'; selectedOptionId: string; timeSpentSeconds?: number }
  | { questionId: string; type: 'TRUE_FALSE'; userBoolean: boolean; timeSpentSeconds?: number }
  | { questionId: string; type: 'OUTPUT_PREDICTION'; userOutput: string; timeSpentSeconds?: number }
  | { questionId: string; type: 'COMPLEXITY'; selectedComplexity: CanonicalComplexity; timeSpentSeconds?: number }
  | { questionId: string; type: 'DEBUGGING'; selectedFixId: string; timeSpentSeconds?: number }
  | { questionId: string; type: 'STRUCTURED_CONCEPTUAL'; selectedAssertionIds: string[]; timeSpentSeconds?: number };

export type IDiagnosticAnswerSubmission = DiagnosticAnswerSubmission;

export function buildDiagnosticSubmission(
  questions: IPublicDiagnosticQuestion[],
  answers: Record<string, any>
): DiagnosticAnswerSubmission[] {
  return questions.map((q) => {
    const raw = answers[q.questionId];

    switch (q.type) {
      case 'MCQ':
        return {
          questionId: q.questionId,
          type: 'MCQ',
          selectedOptionId: typeof raw === 'string' ? raw.trim() : String(raw ?? ''),
        };

      case 'TRUE_FALSE':
        return {
          questionId: q.questionId,
          type: 'TRUE_FALSE',
          userBoolean: typeof raw === 'boolean' ? raw : String(raw).toLowerCase() === 'true',
        };

      case 'OUTPUT_PREDICTION':
        return {
          questionId: q.questionId,
          type: 'OUTPUT_PREDICTION',
          userOutput: typeof raw === 'string' ? raw : String(raw ?? ''),
        };

      case 'COMPLEXITY':
        return {
          questionId: q.questionId,
          type: 'COMPLEXITY',
          selectedComplexity: raw as CanonicalComplexity,
        };

      case 'DEBUGGING':
        return {
          questionId: q.questionId,
          type: 'DEBUGGING',
          selectedFixId: typeof raw === 'string' ? raw.trim() : String(raw ?? ''),
        };

      case 'STRUCTURED_CONCEPTUAL': {
        const ids = Array.isArray(raw)
          ? raw
          : typeof raw === 'string' && raw.trim()
          ? [raw.trim()]
          : [];
        return {
          questionId: q.questionId,
          type: 'STRUCTURED_CONCEPTUAL',
          selectedAssertionIds: ids,
        };
      }

      default:
        throw new Error(`Unsupported diagnostic question type: ${(q as any).type}`);
    }
  });
}

export interface IDiagnosticEvaluation {
  questionId: string;
  type: DiagnosticQuestionType;
  isCorrect: boolean;
  timeSpentSeconds?: number;
  userAnswer?: string;
  correctAnswer?: string;
  submittedOptionId?: string;
  correctOptionId?: string;
  submittedBoolean?: boolean;
  correctBoolean?: boolean;
  submittedOutput?: string;
  expectedOutput?: string;
  submittedComplexity?: string;
  expectedComplexity?: string;
  submittedFixId?: string;
  correctFixId?: string;
  submittedAssertionIds?: string[];
  correctAssertionIds?: string[];
  explanation?: string;
}

export interface IRevisionDiagnosticResponse {
  revisionId: string;
  targetIntervalIndex: number;
  topic?: {
    id: string;
    name: string;
    slug?: string;
    stabilityDays?: number;
  };
  questions: IPublicDiagnosticQuestion[];
}

export interface IRevisionSubmitResponse {
  completedRevision?: any;
  isPassing: boolean;
  correctCount: number;
  totalQuestions: number;
  scorePercentage: number;
  evaluations: IDiagnosticEvaluation[];
  topicStatus: TopicLifecycleStatus;
  masteryScore: number;
  stabilityDays: number;
  nextIntervalDays: number;
  nextIntervalIndex?: number;
  nextDueDate?: string;
  nextRevision?: {
    _id?: string;
    scheduledDate?: string | Date;
  };
}

