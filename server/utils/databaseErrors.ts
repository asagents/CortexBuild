import { logger } from './logger';

/**
 * Database Error Types
 * Maps database error codes to user-friendly messages
 */
export enum DatabaseErrorCode {
  CONSTRAINT_VIOLATION = 'SQLITE_CONSTRAINT',
  FOREIGN_KEY_VIOLATION = 'SQLITE_CONSTRAINT_FOREIGNKEY',
  UNIQUE_VIOLATION = 'SQLITE_CONSTRAINT_UNIQUE',
  NOT_NULL_VIOLATION = 'SQLITE_CONSTRAINT_NOTNULL',
  PRIMARY_KEY_VIOLATION = 'SQLITE_CONSTRAINT_PRIMARYKEY',
  BUSY = 'SQLITE_BUSY',
  LOCKED = 'SQLITE_LOCKED',
  READONLY = 'SQLITE_READONLY',
  IOERR = 'SQLITE_IOERR',
  CORRUPT = 'SQLITE_CORRUPT',
  FULL = 'SQLITE_FULL',
  CANTOPEN = 'SQLITE_CANTOPEN',
  PROTOCOL = 'SQLITE_PROTOCOL',
  SCHEMA = 'SQLITE_SCHEMA',
  TOOBIG = 'SQLITE_TOOBIG',
  MISMATCH = 'SQLITE_MISMATCH',
}

/**
 * Custom Database Error Class
 */
export class DatabaseError extends Error {
  public readonly code: string;
  public readonly errno?: number;
  public readonly query?: string;
  public readonly timestamp: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string = 'UNKNOWN',
    errno?: number,
    query?: string
  ) {
    super(message);
    this.code = code;
    this.errno = errno;
    this.query = query;
    this.timestamp = new Date().toISOString();
    this.isOperational = true;
    this.name = 'DatabaseError';

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Parse database Error and Return User-Friendly Message
 */
export const parseDatabaseError = (err: any): DatabaseError => {
  const code = err.code || 'UNKNOWN';
  const errno = err.errno;
  const query = err.sql || undefined;

  // Constraint violations
  if (code.includes('CONSTRAINT')) {
    if (code.includes('UNIQUE')) {
      return new DatabaseError(
        'A record with this value already exists',
        DatabaseErrorCode.UNIQUE_VIOLATION,
        errno,
        query
      );
    }
    if (code.includes('FOREIGNKEY')) {
      return new DatabaseError(
        'Cannot complete operation: referenced record does not exist',
        DatabaseErrorCode.FOREIGN_KEY_VIOLATION,
        errno,
        query
      );
    }
    if (code.includes('NOTNULL')) {
      return new DatabaseError(
        'Required field is missing',
        DatabaseErrorCode.NOT_NULL_VIOLATION,
        errno,
        query
      );
    }
    if (code.includes('PRIMARYKEY')) {
      return new DatabaseError(
        'A record with this ID already exists',
        DatabaseErrorCode.PRIMARY_KEY_VIOLATION,
        errno,
        query
      );
    }
    return new DatabaseError(
      'Data validation failed',
      DatabaseErrorCode.CONSTRAINT_VIOLATION,
      errno,
      query
    );
  }

  // Database locked/busy errors
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    return new DatabaseError(
      'Database is temporarily busy. Please try again.',
      code,
      errno,
      query
    );
  }

  // Read-only errors
  if (code === 'SQLITE_READONLY') {
    return new DatabaseError(
      'Database is in read-only mode',
      DatabaseErrorCode.READONLY,
      errno,
      query
    );
  }

  // I/O errors
  if (code === 'SQLITE_IOERR') {
    return new DatabaseError(
      'Database I/O error occurred',
      DatabaseErrorCode.IOERR,
      errno,
      query
    );
  }

  // Corruption errors
  if (code === 'SQLITE_CORRUPT') {
    return new DatabaseError(
      'Database corruption detected. Please contact support.',
      DatabaseErrorCode.CORRUPT,
      errno,
      query
    );
  }

  // Disk full errors
  if (code === 'SQLITE_FULL') {
    return new DatabaseError(
      'Storage is full. Cannot save data.',
      DatabaseErrorCode.FULL,
      errno,
      query
    );
  }

  // Cannot open database
  if (code === 'SQLITE_CANTOPEN') {
    return new DatabaseError(
      'Cannot open database file',
      DatabaseErrorCode.CANTOPEN,
      errno,
      query
    );
  }

  // Schema errors
  if (code === 'SQLITE_SCHEMA') {
    return new DatabaseError(
      'Database schema has changed. Please refresh.',
      DatabaseErrorCode.SCHEMA,
      errno,
      query
    );
  }

  // Data too big
  if (code === 'SQLITE_TOOBIG') {
    return new DatabaseError(
      'Data is too large to process',
      DatabaseErrorCode.TOOBIG,
      errno,
      query
    );
  }

  // Type mismatch
  if (code === 'SQLITE_MISMATCH') {
    return new DatabaseError(
      'Data type mismatch',
      DatabaseErrorCode.MISMATCH,
      errno,
      query
    );
  }

  // Generic database error
  return new DatabaseError(
    err.message || 'Database operation failed',
    code,
    errno,
    query
  );
};

/**
 * Safe Database Query Wrapper
 * Automatically handles errors and retries
 */
export const safeQuery = async <T>(
  operation: () => T,
  maxRetries: number = 3,
  retryDelay: number = 100
): Promise<T> => {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return operation();
    } catch (err: any) {
      lastError = err;

      // Log attempt
      logger.warn(`Database operation failed (attempt ${attempt}/${maxRetries})`, {
        code: err.code,
        message: err.message,
      });

      // If it's a busy/locked error, retry
      if (
        (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED') &&
        attempt < maxRetries
      ) {
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        continue;
      }

      // For other errors, throw immediately
      throw parseDatabaseError(err);
    }
  }

  // Max retries reached
  throw parseDatabaseError(lastError);
};

/**
 * Usage Examples:
 *
 * 1. Safe query with retry:
 *    const users = await safeQuery(() =>
 *      supabase.from('users').select().eq('company_id', companyId)
 *    );
 *
 * 2. Error handling in routes:
 *    try {
 *      const project = await supabase.from('projects').select().eq('id', id).single();
 *    } catch (err) {
 *      const dbError = parseDatabaseError(err);
 *      throw new AppError(dbError.message, 500);
 *    }
 */
