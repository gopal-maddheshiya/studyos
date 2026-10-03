import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRoutineBlock {
  blockId: string;
  name: string; // e.g. "Morning DSA"
  startTime: string; // "07:00"
  endTime: string; // "09:30"
  targetSubjectId?: Types.ObjectId;
  blockType: 'STUDY' | 'REVISION' | 'PROJECT' | 'CONTEST';
}

export interface ITimetableRoutine extends Document {
  userId: Types.ObjectId;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, 1 = Monday...
  blocks: IRoutineBlock[];
  createdAt: Date;
  updatedAt: Date;
}

const RoutineBlockSchema = new Schema<IRoutineBlock>(
  {
    blockId: { type: String, required: true },
    name: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    targetSubjectId: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
    blockType: {
      type: String,
      enum: ['STUDY', 'REVISION', 'PROJECT', 'CONTEST'],
      default: 'STUDY',
    },
  },
  { _id: false }
);

const TimetableRoutineSchema = new Schema<ITimetableRoutine>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    blocks: [RoutineBlockSchema],
  },
  { timestamps: true }
);

TimetableRoutineSchema.index({ userId: 1, dayOfWeek: 1 }, { unique: true });

export const TimetableRoutine = mongoose.model<ITimetableRoutine>('TimetableRoutine', TimetableRoutineSchema);
