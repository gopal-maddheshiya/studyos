import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IStudySession extends Document {
  userId: Types.ObjectId;
  topicId: Types.ObjectId;
  startTime: Date;
  endTime?: Date;
  durationMinutes: number;
  activeFocusMinutes: number;
  verifiedActiveSeconds: number;
  heartbeatsLogged: number;
  lastHeartbeatAt: Date;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  maxDurationMinutes: number;
  sessionNotes?: string;
  wasPlanned: boolean;
  timetableBlockId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const StudySessionSchema = new Schema<IStudySession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true, index: true },
    startTime: { type: Date, required: true, default: Date.now },
    endTime: { type: Date },
    durationMinutes: { type: Number, default: 0 },
    activeFocusMinutes: { type: Number, default: 0 },
    verifiedActiveSeconds: { type: Number, default: 0 },
    heartbeatsLogged: { type: Number, default: 0 },
    lastHeartbeatAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['ACTIVE', 'COMPLETED', 'ABANDONED'],
      default: 'ACTIVE',
      index: true,
    },
    maxDurationMinutes: { type: Number, default: 240 },
    sessionNotes: { type: String, default: '' },
    wasPlanned: { type: Boolean, default: false },
    timetableBlockId: { type: Schema.Types.ObjectId, ref: 'ScheduledStudyBlock', default: null },
  },
  { timestamps: true }
);

StudySessionSchema.index({ userId: 1, startTime: -1 });

export const StudySession = mongoose.model<IStudySession>('StudySession', StudySessionSchema);
