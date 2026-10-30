import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { env } from '../config/env.js';
import { authMiddleware } from '../middlewares/auth.js';
import { enforceAuthOriginPolicy } from '../middlewares/originValidation.js';

export const authRouter = Router();

// Helpers
function generateRawToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createAccessToken(user: any): string {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, roles: user.roles, timezone: user.timezone },
    env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function setAuthCookies(res: Response, accessToken: string, rawRefreshToken?: string): void {
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60 * 1000, // 15 mins
  });

  if (rawRefreshToken) {
    res.cookie('refreshToken', rawRefreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }
}

function clearAuthCookies(res: Response): void {
  res.cookie('accessToken', '', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  res.cookie('refreshToken', '', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: 0,
  });
}

function isTransactionUnsupportedError(err: any): boolean {
  if (!err) return false;
  if (err.code === 20 || err.codeName === 'IllegalOperation') return true;
  const msg = String(err.message || '');
  return (
    msg.includes('Transaction numbers are only allowed on a replica set member') ||
    (msg.includes('replica set') && msg.includes('transaction')) ||
    msg.includes('Transactions are not supported') ||
    msg.includes('does not support transactions')
  );
}

// 1. Register
authRouter.post('/register', enforceAuthOriginPolicy, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name, timezone } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Email, password, and name are required.' },
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists.' },
      });
    }

    const passwordHash = await argon2.hash(password);
    const user = await User.create({
      email,
      passwordHash,
      name,
      timezone: timezone || 'Asia/Kolkata',
    });

    const accessToken = createAccessToken(user);
    const rawRefreshToken = generateRawToken();
    const tokenHash = hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const now = new Date();

    await RefreshSession.create({
      userId: user._id,
      tokenHash,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
      archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000), // 60 days
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip || '',
    });

    setAuthCookies(res, accessToken, rawRefreshToken);

    res.status(201).json({
      success: true,
      data: {
        user: { id: user._id, email: user.email, name: user.name, timezone: user.timezone },
        accessToken,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 2. Login
authRouter.post('/login', enforceAuthOriginPolicy, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
    }

    const accessToken = createAccessToken(user);
    const rawRefreshToken = generateRawToken();
    const tokenHash = hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const now = new Date();

    await RefreshSession.create({
      userId: user._id,
      tokenHash,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip || '',
    });

    setAuthCookies(res, accessToken, rawRefreshToken);

    res.json({
      success: true,
      data: {
        user: { id: user._id, email: user.email, name: user.name, timezone: user.timezone },
        accessToken,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 3. Refresh (Browser contract: strictly cookie-only, no req.body.refreshToken)
authRouter.post('/refresh', enforceAuthOriginPolicy, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawRefreshToken = req.cookies?.refreshToken;

    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_REFRESH_TOKEN',
          message: 'Refresh token cookie is required.',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const incomingHash = hashToken(rawRefreshToken);
    const session = await RefreshSession.findOne({ tokenHash: incomingHash });

    if (!session) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid refresh token.',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const user = await User.findById(session.userId);
    if (!user) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User associated with session not found.',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const now = new Date();

    // Check if session has already expired
    if (session.expiresAt.getTime() <= now.getTime()) {
      if (!session.revokedAt) {
        await RefreshSession.updateOne(
          { _id: session._id, revokedAt: null },
          { $set: { revokedAt: now, revocationReason: 'EXPIRED' } }
        );
      }
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: {
          code: 'EXPIRED_REFRESH_TOKEN',
          message: 'Refresh token has expired.',
          timestamp: now.toISOString(),
        },
      });
    }

    // CASE A: Active, non-revoked session -> Transactionally Atomic Rotation
    if (!session.revokedAt) {
      // Deterministically generate token material and successor identity BEFORE entering transaction/retry callback
      const successorSessionId = new mongoose.Types.ObjectId();
      const newRawRefreshToken = generateRawToken();
      const newTokenHash = hashToken(newRawRefreshToken);

      let mongoSession: mongoose.ClientSession;
      try {
        mongoSession = await mongoose.startSession();
      } catch (err: any) {
        if (isTransactionUnsupportedError(err)) {
          return res.status(500).json({
            success: false,
            error: {
              code: 'TRANSACTION_NOT_SUPPORTED',
              message: 'MongoDB deployment does not support multi-document transactions (replica set required).',
              timestamp: new Date().toISOString(),
            },
          });
        }
        return next(err);
      }

      let rotationCommitted = false;

      try {
        await mongoSession.withTransaction(async () => {
          // 1. Confirm predecessor is still eligible for rotation & conditionally mark it rotated (CAS)
          const rotatedPredecessor = await RefreshSession.findOneAndUpdate(
            {
              _id: session._id,
              revokedAt: null,
              expiresAt: { $gt: now },
            },
            {
              $set: {
                revokedAt: now,
                revocationReason: 'ROTATED',
                replacedBySessionId: successorSessionId,
              },
            },
            { new: true, session: mongoSession }
          );

          // If losing CAS race to a concurrent transaction, do not insert successor
          if (!rotatedPredecessor) {
            rotationCommitted = false;
            return;
          }

          // 2. Create exactly one successor RefreshSession document within the SAME transaction
          const successor = new RefreshSession({
            _id: successorSessionId,
            userId: user._id,
            tokenHash: newTokenHash,
            familyId: session.familyId,
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
            userAgent: req.headers['user-agent'] || '',
            ipAddress: req.ip || '',
          });

          await successor.save({ session: mongoSession });
          rotationCommitted = true;
        });

        // 3. Issue tokens and set cookies ONLY after transaction has committed
        if (rotationCommitted) {
          const newAccessToken = createAccessToken(user);
          setAuthCookies(res, newAccessToken, newRawRefreshToken);

          return res.json({
            success: true,
            data: {
              user: { id: user._id, email: user.email, name: user.name, timezone: user.timezone },
              accessToken: newAccessToken,
            },
          });
        }
        // If rotationCommitted is false, another concurrent request won the rotation race.
        // Fall through to Case B (Grace window analysis) using the newly committed session state.
      } catch (txErr: any) {
        if (isTransactionUnsupportedError(txErr)) {
          return res.status(500).json({
            success: false,
            error: {
              code: 'TRANSACTION_NOT_SUPPORTED',
              message: 'MongoDB deployment does not support multi-document transactions (replica set required).',
              timestamp: new Date().toISOString(),
            },
          });
        }
        // If the transaction aborted due to an error, rethrow to outer catch (no cookies set, rolled back)
        throw txErr;
      } finally {
        await mongoSession.endSession();
      }
    }

    // CASE B / C: Session already revoked (either previously, or rotated by a concurrent request)
    const targetSession = session.revokedAt ? session : await RefreshSession.findById(session._id);

    if (!targetSession) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Refresh session not found.',
          timestamp: now.toISOString(),
        },
      });
    }

    if (targetSession.revocationReason === 'ROTATED' && targetSession.replacedBySessionId && targetSession.revokedAt) {
      const elapsedMs = now.getTime() - targetSession.revokedAt.getTime();
      const graceMs = env.AUTH_REFRESH_GRACE_SECONDS * 1000;

      // CASE B: Within configurable grace window -> Issue access token only, DO NOT create successor
      if (graceMs > 0 && elapsedMs <= graceMs) {
        let successor = await RefreshSession.findById(targetSession.replacedBySessionId);

        // If rotated just milliseconds ago by racing winner, wait briefly for successor insert to finish
        if (!successor && elapsedMs < 2000) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          successor = await RefreshSession.findById(targetSession.replacedBySessionId);
        }

        if (!successor || successor.revokedAt) {
          clearAuthCookies(res);
          return res.status(401).json({
            success: false,
            error: {
              code: 'REFRESH_SESSION_REVOKED',
              message: 'Successor session is no longer active.',
              timestamp: now.toISOString(),
            },
          });
        }

        // ATOMIC COUNTER INCREMENT: prevent race conditions and lost updates
        const updatedPredecessor = await RefreshSession.findOneAndUpdate(
          { _id: targetSession._id, revocationReason: 'ROTATED' },
          { $inc: { graceReplayCount: 1 } },
          { new: true }
        );

        const currentGraceCount = updatedPredecessor?.graceReplayCount ?? (targetSession.graceReplayCount + 1);

        // Anti-abuse replay cap: strictly compromise family if replay count exceeds allowed threshold (> 2)
        if (currentGraceCount > 2) {
          await RefreshSession.updateMany(
            { familyId: targetSession.familyId, revokedAt: null },
            { $set: { revokedAt: now, revocationReason: 'FAMILY_COMPROMISE_DETECTED' } }
          );
          clearAuthCookies(res);
          return res.status(401).json({
            success: false,
            error: {
              code: 'REUSED_REFRESH_TOKEN',
              message: 'Excessive grace window replays detected. Session terminated for security.',
              timestamp: now.toISOString(),
            },
          });
        }

        console.warn('[AUTH_REFRESH_GRACE_INVOKED]', {
          familyId: targetSession.familyId,
          predecessorSessionId: targetSession._id.toString(),
          successorSessionId: targetSession.replacedBySessionId.toString(),
          elapsedMs,
          graceReplayCount: currentGraceCount,
        });

        // Issue fresh access token only; DO NOT create a new refresh session or branch the chain
        const freshAccessToken = createAccessToken(user);
        res.cookie('accessToken', freshAccessToken, {
          httpOnly: true,
          secure: env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 15 * 60 * 1000,
        });

        return res.json({
          success: true,
          data: {
            user: { id: user._id, email: user.email, name: user.name, timezone: user.timezone },
            accessToken: freshAccessToken,
          },
        });
      }

      // CASE C: Elapsed time > grace window (or graceMs === 0) -> Token Replay Outside Grace -> Family Compromise
      await RefreshSession.updateMany(
        { familyId: targetSession.familyId, revokedAt: null },
        { $set: { revokedAt: now, revocationReason: 'FAMILY_COMPROMISE_DETECTED' } }
      );
      clearAuthCookies(res);

      console.error('[SECURITY_ALERT: REUSED_REFRESH_TOKEN]', {
        familyId: targetSession.familyId,
        predecessorSessionId: targetSession._id.toString(),
        elapsedMs,
      });

      return res.status(401).json({
        success: false,
        error: {
          code: 'REUSED_REFRESH_TOKEN',
          message: 'Security compromise detected: Replay of an already rotated refresh token. All sessions revoked.',
          timestamp: now.toISOString(),
        },
      });
    }

    // Other non-rotation revocation reasons (LOGOUT, EXPIRED, FAMILY_COMPROMISE_DETECTED)
    clearAuthCookies(res);
    return res.status(401).json({
      success: false,
      error: {
        code: 'REFRESH_SESSION_REVOKED',
        message: 'This refresh session has been revoked.',
        timestamp: now.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// 4. Logout
authRouter.post('/logout', enforceAuthOriginPolicy, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawRefreshToken = req.cookies?.refreshToken;

    if (rawRefreshToken && typeof rawRefreshToken === 'string') {
      const tokenHash = hashToken(rawRefreshToken);
      await RefreshSession.updateOne(
        { tokenHash, revokedAt: null },
        { $set: { revokedAt: new Date(), revocationReason: 'LOGOUT' } }
      );
    }

    clearAuthCookies(res);

    res.json({
      success: true,
      data: { message: 'Logged out successfully.' },
    });
  } catch (err) {
    next(err);
  }
});

// 5. Current User Profile
authRouter.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?.id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User profile not found.' },
      });
    }

    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});
