import mongoose, { Document, Schema, Types } from 'mongoose';

export type QuestionType = 'MCQ' | 'OUTPUT_PREDICTION' | 'DEBUGGING' | 'CONCEPTUAL' | 'CODING';

export interface IQuestion {
  questionId: string;
  type: QuestionType;
  prompt: string;
  codeSnippet?: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  distractorExplanations?: Record<string, string>;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

export interface IPublicQuestion {
  questionId: string;
  type: QuestionType;
  prompt: string;
  codeSnippet?: string;
  options?: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

export interface IPublicQuiz {
  _id: string;
  topicId: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  questions: IPublicQuestion[];
  createdAt: Date;
}

export interface IQuiz extends Document {
  userId: Types.ObjectId;
  topicId: Types.ObjectId;
  generatedBy: 'AI' | 'SYSTEM' | 'MANUAL';
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  questions: IQuestion[];
  createdAt: Date;
}

export interface IQuizSubmission extends Document {
  quizId: Types.ObjectId;
  topicId: Types.ObjectId;
  userId: Types.ObjectId;
  answers: Array<{
    questionId: string;
    userAnswer: string;
    isCorrect: boolean;
    timeSpentSeconds: number;
  }>;
  scorePercentage: number;
  promotedState?: string;
  evaluatedAt: Date;
}

const QuestionSchema = new Schema<IQuestion>(
  {
    questionId: { type: String, required: true },
    type: {
      type: String,
      enum: ['MCQ', 'OUTPUT_PREDICTION', 'DEBUGGING', 'CONCEPTUAL', 'CODING'],
      required: true,
    },
    prompt: { type: String, required: true },
    codeSnippet: { type: String },
    options: { type: [String], default: [] },
    correctAnswer: { type: String, required: true },
    explanation: { type: String, required: true },
    distractorExplanations: { type: Map, of: String },
    difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD'], default: 'MEDIUM' },
  },
  { _id: false }
);

const QuizSchema = new Schema<IQuiz>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true, index: true },
    generatedBy: { type: String, enum: ['AI', 'SYSTEM', 'MANUAL'], default: 'AI' },
    difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD'], default: 'MEDIUM' },
    questions: [QuestionSchema],
  },
  { timestamps: true }
);

const QuizSubmissionSchema = new Schema<IQuizSubmission>(
  {
    quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    answers: [
      {
        questionId: { type: String, required: true },
        userAnswer: { type: String, required: true },
        isCorrect: { type: Boolean, required: true },
        timeSpentSeconds: { type: Number, default: 0 },
      },
    ],
    scorePercentage: { type: Number, required: true },
    promotedState: { type: String },
    evaluatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Quiz = mongoose.model<IQuiz>('Quiz', QuizSchema);
export const QuizSubmission = mongoose.model<IQuizSubmission>('QuizSubmission', QuizSubmissionSchema);
