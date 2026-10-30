import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export function getEffectiveAllowedOrigins(): Set<string> {
  const allowed = new Set<string>([env.CLIENT_ORIGIN]);
  if (env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:5173');
    allowed.add('http://127.0.0.1:5173');
    allowed.add('http://localhost:5174');
    allowed.add('http://127.0.0.1:5174');
  }
  return allowed;
}

export function enforceAuthOriginPolicy(req: Request, res: Response, next: NextFunction): void {
  // Only enforce on state-changing mutation requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  let requestOrigin: string | undefined = origin;

  if (!requestOrigin && referer) {
    try {
      requestOrigin = new URL(referer).origin;
    } catch {
      // Malformed referer header
    }
  }

  if (!requestOrigin) {
    res.status(403).json({
      success: false,
      error: {
        code: 'MISSING_ORIGIN_HEADER',
        message: 'State-changing authentication requests require an explicit Origin or Referer header.',
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  const allowedOrigins = getEffectiveAllowedOrigins();
  if (!allowedOrigins.has(requestOrigin)) {
    res.status(403).json({
      success: false,
      error: {
        code: 'CSRF_ORIGIN_MISMATCH',
        message: `Cross-origin request from origin "${requestOrigin}" is forbidden.`,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  next();
}
