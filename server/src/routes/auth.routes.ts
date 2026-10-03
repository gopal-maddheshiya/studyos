import { Router, Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { authMiddleware } from '../middlewares/auth.js';

export const authRouter = Router();

// Register
authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
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

    const accessToken = jwt.sign(
      { id: user._id.toString(), email: user.email, roles: user.roles, timezone: user.timezone },
      env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });

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

// Login
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
    }

    const accessToken = jwt.sign(
      { id: user._id.toString(), email: user.email, roles: user.roles, timezone: user.timezone },
      env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });

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

// Get current user profile
authRouter.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?.id).select('-passwordHash -refreshTokenHash');
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
