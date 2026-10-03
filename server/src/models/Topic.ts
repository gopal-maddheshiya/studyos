import mongoose, { Document, Schema, Types } from 'mongoose';

export type TopicLifecycleStatus = 'NOT_STARTED' | 'LEARNING' | 'ASSESSED' | 'RETAINED' | 'MASTERED';

export interface ITopic extends Document {
  userId: Types.ObjectId;
  subjectId: Types.ObjectId;
  name: string;
  slug: string;
  parentTopicId?: Types.ObjectId; // For subtopics
  lifecycleStatus: TopicLifecycleStatus;
  masteryScore: number; // 0 to 100
  comprehensionScore: number; // 0 to 100
  applicationScore: number; // 0 to 100
  retentionScore: number; // 0 to 100
  consistencyScore: number; // 0 to 100
  stabilityDays: number; // Memory stability
  lastStudiedAt?: Date;
  lastRevisedAt?: Date;
  nextRevisionDueDate?: Date;
  revisionCycleCount: number;
  decayRisk: boolean;
  totalStudyMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

const TopicSchema = new Schema<ITopic>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    parentTopicId: { type: Schema.Types.ObjectId, ref: 'Topic', default: null },
    lifecycleStatus: {
      type: String,
      enum: ['NOT_STARTED', 'LEARNING', 'ASSESSED', 'RETAINED', 'MASTERED'],
      default: 'NOT_STARTED',
      index: true,
    },
    masteryScore: { type: Number, default: 0, min: 0, max: 100 },
    comprehensionScore: { type: Number, default: 0, min: 0, max: 100 },
    applicationScore: { type: Number, default: 0, min: 0, max: 100 },
    retentionScore: { type: Number, default: 0, min: 0, max: 100 },
    consistencyScore: { type: Number, default: 0, min: 0, max: 100 },
    stabilityDays: { type: Number, default: 2.0 },
    lastStudiedAt: { type: Date },
    lastRevisedAt: { type: Date },
    nextRevisionDueDate: { type: Date, index: true },
    revisionCycleCount: { type: Number, default: 0 },
    decayRisk: { type: Boolean, default: false },
    totalStudyMinutes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

TopicSchema.index({ userId: 1, subjectId: 1, slug: 1 }, { unique: true });
TopicSchema.index({ userId: 1, nextRevisionDueDate: 1 });

export const Topic = mongoose.model<ITopic>('Topic', TopicSchema);
