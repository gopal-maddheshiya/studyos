import mongoose, { Document, Schema, Types } from 'mongoose';

export type StudyBlockType = 'LEARNING' | 'REVISION' | 'EXAM_PREP' | 'PROJECT';
export type StudyBlockStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'RESCHEDULED';

export interface IScheduledStudyBlock extends Document {
  userId: Types.ObjectId;
  date: string; // "YYYY-MM-DD" in user localized timezone
  routineBlockId?: string;
  name: string;
  startTime: string; // "07:00"
  endTime: string; // "09:30"
  allocatedTopicId?: Types.ObjectId;
  allocatedSubjectId?: Types.ObjectId;
  type: StudyBlockType;
  plannedMinutes: number;
  actualMinutesLogged: number;
  activeFocusMinutes: number;
  status: StudyBlockStatus;
  rescheduledToDate?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduledStudyBlockSchema = new Schema<IScheduledStudyBlock>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true, index: true },
    routineBlockId: { type: String },
    name: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    allocatedTopicId: { type: Schema.Types.ObjectId, ref: 'Topic', default: null },
    allocatedSubjectId: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
    type: {
      type: String,
      enum: ['LEARNING', 'REVISION', 'EXAM_PREP', 'PROJECT'],
      default: 'LEARNING',
    },
    plannedMinutes: { type: Number, required: true },
    actualMinutesLogged: { type: Number, default: 0 },
    activeFocusMinutes: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'RESCHEDULED'],
      default: 'SCHEDULED',
      index: true,
    },
    rescheduledToDate: { type: String },
  },
  { timestamps: true }
);

ScheduledStudyBlockSchema.index({ userId: 1, date: 1, status: 1 });

export const ScheduledStudyBlock = mongoose.model<IScheduledStudyBlock>(
  'ScheduledStudyBlock',
  ScheduledStudyBlockSchema
);
