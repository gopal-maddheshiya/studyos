import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const status = err.statusCode || err.status || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'An unexpected error occurred.';

  console.error(`[StudyOS API Error] ${req.method} ${req.originalUrl}:`, err);

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      details: err.details || null,
      timestamp: new Date().toISOString(),
    },
  });
}
