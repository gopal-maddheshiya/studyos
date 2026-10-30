import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRefreshSession extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  replacedBySessionId?: Types.ObjectId | null;
  graceReplayCount: number;
  expiresAt: Date;
  archiveCleanupAt: Date;
  revokedAt?: Date | null;
  revocationReason?:
    | 'ROTATED'
    | 'LOGOUT'
    | 'EXPIRED'
    | 'FAMILY_COMPROMISE_DETECTED'
    | 'USER_REVOKED_ALL';
  userAgent?: string;
  ipAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RefreshSessionSchema = new Schema<IRefreshSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    familyId: { type: String, required: true, index: true },
    replacedBySessionId: { type: Schema.Types.ObjectId, ref: 'RefreshSession', default: null },
    graceReplayCount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: true },
    archiveCleanupAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null, index: true },
    revocationReason: {
      type: String,
      enum: ['ROTATED', 'LOGOUT', 'EXPIRED', 'FAMILY_COMPROMISE_DETECTED', 'USER_REVOKED_ALL'],
      default: null,
    },
    userAgent: { type: String },
    ipAddress: { type: String },
  },
  { timestamps: true }
);

// Compound Indexes for fast family and user session queries
RefreshSessionSchema.index({ familyId: 1, revokedAt: 1 });
RefreshSessionSchema.index({ userId: 1, revokedAt: 1 });
// TTL index for physical database cleanup after 60-day audit/replay retention
RefreshSessionSchema.index({ archiveCleanupAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshSession = mongoose.model<IRefreshSession>('RefreshSession', RefreshSessionSchema);
