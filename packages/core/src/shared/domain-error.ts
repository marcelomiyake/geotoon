/** Stable error codes shared with the wire contract (`packages/contracts`). */
export type ErrorCode =
  | 'INVALID_COORDINATES'
  | 'INVALID_QUERY'
  | 'GEOCODER_UNAVAILABLE'
  | 'GEOCODER_RATE_LIMITED'
  | 'OVERTURE_UNAVAILABLE'
  | 'OVERTURE_RELEASE_NOT_FOUND'
  | 'AREA_FETCH_FAILED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'INTERNAL';

export interface DomainErrorOptions {
  readonly retryable?: boolean;
  readonly retryAfterSeconds?: number;
  readonly cause?: unknown;
}

/** An expected failure with a stable code that the API maps to a problem response. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'DomainError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
