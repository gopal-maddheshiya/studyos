import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRevisionSchedule extends Document {
  userId: Types.ObjectId;
  topicId: Types.ObjectId;
  targetIntervalIndex: number; // 1 (Day 2), 2 (Day 4), 3 (Day 7)...
  scheduledDate: Date;
  status: 'PENDING' | 'OVERDUE' | 'COMPLETED' | 'MISSED';
  completedAt?: Date;
  performanceScore?: number;
  recallRating?: number; // 1 to 5
  createdAt: Date;
  updatedAt: Date;
}

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
    recallRating: { type: Number, min: 1, max: 5 },
  },
  { timestamps: true }
);

RevisionScheduleSchema.index({ userId: 1, scheduledDate: 1, status: 1 });

export const RevisionSchedule = mongoose.model<IRevisionSchedule>('RevisionSchedule', RevisionScheduleSchema);
