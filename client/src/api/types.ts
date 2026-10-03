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
