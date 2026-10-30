import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  timezone: string;
  avatarUrl?: string;
  roles: ('USER' | 'ADMIN')[];
  preferences: {
    quietHours: { start: string; end: string };
    notifications: { email: boolean; telegram: boolean; webPush: boolean };
    spacedAlgorithm: 'RULE_2_4_7' | 'SM_2' | 'FSRS';
    missedBlockStrategy: 'PROMPT' | 'AUTO_PUSH';
  };
  telegramChatId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    timezone: { type: String, default: 'UTC' },
    avatarUrl: { type: String },
    roles: { type: [String], default: ['USER'] },
    preferences: {
      quietHours: {
        start: { type: String, default: '22:00' },
        end: { type: String, default: '07:30' },
      },
      notifications: {
        email: { type: Boolean, default: true },
        telegram: { type: Boolean, default: false },
        webPush: { type: Boolean, default: true },
      },
      spacedAlgorithm: { type: String, enum: ['RULE_2_4_7', 'SM_2', 'FSRS'], default: 'RULE_2_4_7' },
      missedBlockStrategy: { type: String, enum: ['PROMPT', 'AUTO_PUSH'], default: 'PROMPT' },
    },
    telegramChatId: { type: String },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', UserSchema);
