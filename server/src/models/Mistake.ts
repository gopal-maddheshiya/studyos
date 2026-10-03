import mongoose, { Document, Schema, Types } from 'mongoose';

export type RootCauseCategory =
  | 'CONCEPTUAL_GAP'
  | 'EDGE_CASE_BLINDNESS'
  | 'EXECUTION_SLIP'
  | 'TIME_COMPLEXITY_EXCEEDED'
  | 'PATTERN_MISIDENTIFICATION';

export interface IMistake extends Document {
  userId: Types.ObjectId;
  topicId: Types.ObjectId;
  origin: 'QUIZ' | 'PRACTICE' | 'REVISION' | 'CONTEST' | 'PROJECT';
  prompt: string;
  codeSnippet?: string;
  userErroneousAnswer: string;
  correctAnswer: string;
  explanation: string;
  rootCause: RootCauseCategory;
  oneLineRule: string;
  recurrenceCount: number;
  status: 'ACTIVE' | 'PROBATION' | 'RESOLVED';
  consecutivePasses: number;
  lastTestedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MistakeSchema = new Schema<IMistake>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true, index: true },
    origin: {
      type: String,
      enum: ['QUIZ', 'PRACTICE', 'REVISION', 'CONTEST', 'PROJECT'],
      default: 'QUIZ',
    },
    prompt: { type: String, required: true },
    codeSnippet: { type: String },
    userErroneousAnswer: { type: String, required: true },
    correctAnswer: { type: String, required: true },
    explanation: { type: String, required: true },
    rootCause: {
      type: String,
      enum: [
        'CONCEPTUAL_GAP',
        'EDGE_CASE_BLINDNESS',
        'EXECUTION_SLIP',
        'TIME_COMPLEXITY_EXCEEDED',
        'PATTERN_MISIDENTIFICATION',
      ],
      required: true,
      index: true,
    },
    oneLineRule: { type: String, required: true },
    recurrenceCount: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['ACTIVE', 'PROBATION', 'RESOLVED'],
      default: 'ACTIVE',
      index: true,
    },
    consecutivePasses: { type: Number, default: 0 },
    lastTestedAt: { type: Date },
  },
  { timestamps: true }
);

MistakeSchema.index({ userId: 1, topicId: 1, status: 1 });

export const Mistake = mongoose.model<IMistake>('Mistake', MistakeSchema);
