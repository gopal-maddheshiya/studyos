import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  IRevisionChallengeQuestion,
  StoredDiagnosticEvaluation,
  CANONICAL_COMPLEXITIES,
  DiagnosticQuestionType,
} from '../types/diagnostic.js';

export interface IRevisionSchedule extends Document {
  userId: Types.ObjectId;
  topicId: Types.ObjectId;
  targetIntervalIndex: number; // 1 (Day 2), 2 (Day 4), 3 (Day 7)...
  scheduledDate: Date;
  status: 'PENDING' | 'OVERDUE' | 'COMPLETED' | 'MISSED';
  completedAt?: Date;
  performanceScore?: number;
  recallConfidence?: number; // 1 to 5
  previousRevisionId?: Types.ObjectId | null;
  challengeQuestions: IRevisionChallengeQuestion[];
  evaluations?: StoredDiagnosticEvaluation[];
  createdAt: Date;
  updatedAt: Date;
}

export const DIAGNOSTIC_QUESTION_TYPES: readonly DiagnosticQuestionType[] = [
  'MCQ',
  'TRUE_FALSE',
  'OUTPUT_PREDICTION',
  'COMPLEXITY',
  'DEBUGGING',
  'STRUCTURED_CONCEPTUAL',
] as const;

// -----------------------------------------------------------------------------
// 1. QUESTION SUBDOCUMENT SCHEMAS (DISCRIMINATED UNION)
// -----------------------------------------------------------------------------

export const BaseQuestionSchema = new Schema(
  {
    questionId: { type: String, required: true },
    type: { type: String, required: true, enum: DIAGNOSTIC_QUESTION_TYPES },
    prompt: { type: String, required: true },
    codeSnippet: { type: String },
    explanation: { type: String, required: true },
    difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD'], default: 'MEDIUM', required: true },
  },
  { discriminatorKey: 'type', _id: false, strict: 'throw' }
);

const MCQOptionSchema = new Schema(
  {
    optionId: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false, strict: 'throw' }
);

export const MCQQuestionSchema = new Schema(
  {
    options: {
      type: [MCQOptionSchema],
      required: true,
      validate: {
        validator: (v: any[]) => Array.isArray(v) && v.length >= 2,
        message: 'MCQ questions must provide at least 2 options',
      },
    },
    correctOptionId: { type: String, required: true },
  },
  { _id: false, strict: 'throw' }
);

export const TrueFalseQuestionSchema = new Schema(
  {
    correctBoolean: { type: Boolean, required: true },
  },
  { _id: false, strict: 'throw' }
);

export const OutputPredictionQuestionSchema = new Schema(
  {
    expectedOutput: { type: String, required: true },
    normalization: {
      type: String,
      enum: ['EXACT', 'WHITESPACE_TRIMMED', 'CASE_INSENSITIVE_TRIMMED'],
      default: 'WHITESPACE_TRIMMED',
    },
  },
  { _id: false, strict: 'throw' }
);

export const ComplexityQuestionSchema = new Schema(
  {
    expectedComplexity: {
      type: String,
      enum: CANONICAL_COMPLEXITIES,
      required: true,
    },
    targetMetric: {
      type: String,
      enum: ['TIME_WORST', 'TIME_AVERAGE', 'SPACE_AUXILIARY'],
      default: 'TIME_WORST',
    },
  },
  { _id: false, strict: 'throw' }
);

const DebuggingOptionSchema = new Schema(
  {
    fixId: { type: String, required: true },
    description: { type: String, required: true },
  },
  { _id: false, strict: 'throw' }
);

export const DebuggingQuestionSchema = new Schema(
  {
    debuggingOptions: {
      type: [DebuggingOptionSchema],
      required: true,
      validate: {
        validator: (v: any[]) => Array.isArray(v) && v.length >= 1,
        message: 'Debugging questions must provide at least one debuggingOption',
      },
    },
    correctFixId: { type: String, required: true },
  },
  { _id: false, strict: 'throw' }
);

const ConceptualAssertionSchema = new Schema(
  {
    assertionId: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false, strict: 'throw' }
);

export const StructuredConceptualQuestionSchema = new Schema(
  {
    assertions: {
      type: [ConceptualAssertionSchema],
      required: true,
      validate: {
        validator: (v: any[]) => Array.isArray(v) && v.length >= 1,
        message: 'Structured conceptual questions must provide at least one assertion',
      },
    },
    correctAssertionIds: {
      type: [String],
      required: true,
      validate: {
        validator: (v: string[]) => Array.isArray(v) && v.length >= 1,
        message: 'Structured conceptual questions must specify at least one correctAssertionId',
      },
    },
  },
  { _id: false, strict: 'throw' }
);

// -----------------------------------------------------------------------------
// 2. EVALUATION SUBDOCUMENT SCHEMAS (DISCRIMINATED UNION)
// -----------------------------------------------------------------------------

export const BaseEvaluationSchema = new Schema(
  {
    questionId: { type: String, required: true },
    type: { type: String, required: true, enum: DIAGNOSTIC_QUESTION_TYPES },
    isCorrect: { type: Boolean, required: true },
    timeSpentSeconds: { type: Number, required: true, default: 0 },
  },
  { discriminatorKey: 'type', _id: false, strict: 'throw' }
);

export const MCQEvaluationSchema = new Schema(
  {
    submittedOptionId: { type: String, required: true, default: '' },
    correctOptionId: { type: String, required: true },
  },
  { _id: false, strict: 'throw' }
);

export const TrueFalseEvaluationSchema = new Schema(
  {
    submittedBoolean: { type: Boolean, required: true },
    correctBoolean: { type: Boolean, required: true },
  },
  { _id: false, strict: 'throw' }
);

export const OutputPredictionEvaluationSchema = new Schema(
  {
    submittedOutput: { type: String, required: true, default: '' },
    normalizedSubmittedOutput: { type: String, required: true, default: '' },
    expectedOutput: { type: String, required: true },
  },
  { _id: false, strict: 'throw' }
);

export const ComplexityEvaluationSchema = new Schema(
  {
    submittedComplexity: {
      type: String,
      enum: ['', ...CANONICAL_COMPLEXITIES],
      required: true,
      default: '',
    },
    expectedComplexity: {
      type: String,
      enum: CANONICAL_COMPLEXITIES,
      required: true,
    },
  },
  { _id: false, strict: 'throw' }
);

export const DebuggingEvaluationSchema = new Schema(
  {
    submittedFixId: { type: String, required: true, default: '' },
    correctFixId: { type: String, required: true },
  },
  { _id: false, strict: 'throw' }
);

export const StructuredConceptualEvaluationSchema = new Schema(
  {
    submittedAssertionIds: { type: [String], required: true, default: [] },
    correctAssertionIds: { type: [String], required: true, default: [] },
  },
  { _id: false, strict: 'throw' }
);

// -----------------------------------------------------------------------------
// 3. MAIN REVISIONSCHEDULE SCHEMA
// -----------------------------------------------------------------------------

const RevisionScheduleSchema = new Schema<IRevisionSchedule>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true, index: true },
    targetIntervalIndex: { type: Number, required: true },
    scheduledDate: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['PENDING', 'OVERDUE', 'COMPLETED', 'MISSED'],
      default: 'PENDING',
      index: true,
    },
    completedAt: { type: Date },
    performanceScore: { type: Number },
    recallConfidence: { type: Number, min: 1, max: 5 },
    previousRevisionId: { type: Schema.Types.ObjectId, ref: 'RevisionSchedule', default: null },
    challengeQuestions: {
      type: [BaseQuestionSchema],
      default: [],
    },
    evaluations: {
      type: [BaseEvaluationSchema],
      default: undefined,
    },
  },
  { timestamps: true }
);

// Attach Question Discriminators
const questionsArray = RevisionScheduleSchema.path('challengeQuestions') as mongoose.Schema.Types.DocumentArray;
questionsArray.discriminator('MCQ', MCQQuestionSchema);
questionsArray.discriminator('TRUE_FALSE', TrueFalseQuestionSchema);
questionsArray.discriminator('OUTPUT_PREDICTION', OutputPredictionQuestionSchema);
questionsArray.discriminator('COMPLEXITY', ComplexityQuestionSchema);
questionsArray.discriminator('DEBUGGING', DebuggingQuestionSchema);
questionsArray.discriminator('STRUCTURED_CONCEPTUAL', StructuredConceptualQuestionSchema);

// Attach Evaluation Discriminators
const evaluationsArray = RevisionScheduleSchema.path('evaluations') as mongoose.Schema.Types.DocumentArray;
evaluationsArray.discriminator('MCQ', MCQEvaluationSchema);
evaluationsArray.discriminator('TRUE_FALSE', TrueFalseEvaluationSchema);
evaluationsArray.discriminator('OUTPUT_PREDICTION', OutputPredictionEvaluationSchema);
evaluationsArray.discriminator('COMPLEXITY', ComplexityEvaluationSchema);
evaluationsArray.discriminator('DEBUGGING', DebuggingEvaluationSchema);
evaluationsArray.discriminator('STRUCTURED_CONCEPTUAL', StructuredConceptualEvaluationSchema);

// Indexes
RevisionScheduleSchema.index({ userId: 1, scheduledDate: 1, status: 1 });
// Partial unique index: Guarantee at most ONE active (PENDING or OVERDUE) revision per topic per user
RevisionScheduleSchema.index(
  { userId: 1, topicId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['PENDING', 'OVERDUE'] } },
  }
);

export const RevisionSchedule = mongoose.model<IRevisionSchedule>('RevisionSchedule', RevisionScheduleSchema);
