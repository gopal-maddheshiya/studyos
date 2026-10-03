import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISubject extends Document {
  userId: Types.ObjectId;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const SubjectSchema = new Schema<ISubject>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    color: { type: String, default: '#C25E3E' }, // Muted terracotta
    icon: { type: String, default: 'BookOpen' },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

SubjectSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Subject = mongoose.model<ISubject>('Subject', SubjectSchema);
