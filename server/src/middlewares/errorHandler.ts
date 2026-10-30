import { Request, Response, NextFunction } from 'express';

export interface IAppErrorPayload {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
  };
}

/**
 * Checks whether an error is a MongoDB duplicate-key error.
 */
export function isDuplicateKeyError(err: any): boolean {
  if (!err) return false;
  return (
    err.code === 11000 ||
    err.code === 11001 ||
    err.codeName === 'DuplicateKey' ||
    Boolean(typeof err.message === 'string' && err.message.includes('E11000 duplicate key error'))
  );
}

/**
 * Checks whether an error is a Mongoose CastError or BSON ObjectId parsing error.
 */
export function isCastError(err: any): boolean {
  if (!err) return false;
  return (
    err.name === 'CastError' ||
    err.name === 'BSONError' ||
    err.name === 'BSONTypeError' ||
    err.kind === 'ObjectId' ||
    Boolean(typeof err.message === 'string' && err.message.includes('Cast to ObjectId failed'))
  );
}

/**
 * Checks whether an error is a Mongoose ValidationError.
 */
export function isMongooseValidationError(err: any): boolean {
  if (!err) return false;
  return (
    err.name === 'ValidationError' &&
    Boolean(err.errors || (typeof err.message === 'string' && err.message.includes('validation failed')))
  );
}

/**
 * Checks whether an error comes from the MongoDB driver or internal Mongoose engine.
 */
export function isDatabaseDriverError(err: any): boolean {
  if (!err) return false;
  const name = err.name || '';
  return (
    name.startsWith('Mongo') ||
    name === 'MongooseError' ||
    name === 'BulkWriteError' ||
    typeof err.code === 'number'
  );
}

/**
 * Checks whether a string contains internal database or driver implementation details.
 */
export function containsDatabaseLeakage(msg: string): boolean {
  if (!msg || typeof msg !== 'string') return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('e11000') ||
    lower.includes('duplicate key') ||
    lower.includes('cast to objectid') ||
    lower.includes('validation failed') ||
    lower.includes('collection:') ||
    lower.includes('index:') ||
    lower.includes('dup key:') ||
    lower.includes('mongoservererror') ||
    lower.includes('mongooseerror') ||
    lower.includes('mongodb://') ||
    lower.includes('mongodb+srv://') ||
    lower.includes('27017')
  );
}

/**
 * Maps standard HTTP client error statuses to safe fallback codes.
 */
function getStatusDefaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'RATE_LIMIT_EXCEEDED';
    default:
      return 'CLIENT_ERROR';
  }
}

/**
 * Pure function that sanitizes an arbitrary error into a production-safe HTTP status and JSON response body.
 * Prevents raw MongoDB/Mongoose errors, collection/index info, query fragments, or stack traces from reaching clients.
 */
export function sanitizeErrorResponse(err: any): { status: number; body: IAppErrorPayload } {
  const timestamp = new Date().toISOString();

  // 1. MONGODB DUPLICATE KEY ERROR (E11000 / code 11000)
  if (isDuplicateKeyError(err)) {
    return {
      status: 409,
      body: {
        success: false,
        error: {
          code: 'DUPLICATE_RESOURCE',
          message: 'A resource with these values already exists.',
          timestamp,
        },
      },
    };
  }

  // 2. MONGOOSE CAST ERROR (Malformed ObjectId / Invalid type casting)
  if (isCastError(err)) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'INVALID_IDENTIFIER',
          message: 'The provided identifier is invalid.',
          timestamp,
        },
      },
    };
  }

  // 3. MONGOOSE VALIDATION ERROR
  if (isMongooseValidationError(err)) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The provided data is invalid.',
          timestamp,
        },
      },
    };
  }

  // 4. TRANSACTION NOT SUPPORTED (Approved application 500 error code)
  if (err?.code === 'TRANSACTION_NOT_SUPPORTED') {
    return {
      status: 500,
      body: {
        success: false,
        error: {
          code: 'TRANSACTION_NOT_SUPPORTED',
          message:
            typeof err.message === 'string' && err.message
              ? err.message
              : 'MongoDB deployment does not support multi-document transactions (replica set required).',
          timestamp,
        },
      },
    };
  }

  // 5. OTHER DATABASE DRIVER / MONGOOSE ERRORS (Connection, bulk write, topology, etc.)
  if (isDatabaseDriverError(err)) {
    return {
      status: 500,
      body: {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred.',
          timestamp,
        },
      },
    };
  }

  // 6. LEGITIMATE DOMAIN / APPLICATION CLIENT ERRORS (4xx)
  const status = Number(err?.statusCode || err?.status);
  const isClientError = !isNaN(status) && status >= 400 && status < 500;

  if (isClientError) {
    const rawCode = typeof err?.code === 'string' ? err.code : '';
    const safeCode = rawCode && !containsDatabaseLeakage(rawCode) ? rawCode : getStatusDefaultCode(status);
    const rawMessage = typeof err?.message === 'string' ? err.message : '';
    const safeMessage =
      rawMessage && !containsDatabaseLeakage(rawMessage) ? rawMessage : 'A client request error occurred.';

    return {
      status,
      body: {
        success: false,
        error: {
          code: safeCode,
          message: safeMessage,
          details:
            err?.details &&
            typeof err.details === 'object' &&
            !containsDatabaseLeakage(JSON.stringify(err.details))
              ? err.details
              : null,
          timestamp,
        },
      },
    };
  }

  // 7. ALL OTHER UNEXPECTED / 500 ERRORS
  return {
    status: 500,
    body: {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
        timestamp,
      },
    },
  };
}

/**
 * Central Express Error Handler middleware.
 * Guarantees that internal database errors and stack traces are never exposed in API responses.
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Always log the full detailed error server-side for diagnostic tracing
  console.error(`[StudyOS API Error] ${req.method} ${req.originalUrl}:`, err);

  // If headers have already been sent to client, delegate to Express default handler
  if (res.headersSent) {
    return next(err);
  }

  const { status, body } = sanitizeErrorResponse(err);
  res.status(status).json(body);
}
