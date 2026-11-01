import type { ErrorCode, Problem } from '@geotoon/contracts';

export const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  INVALID_COORDINATES: 400,
  INVALID_QUERY: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  GEOCODER_RATE_LIMITED: 429,
  AREA_FETCH_FAILED: 502,
  OVERTURE_RELEASE_NOT_FOUND: 502,
  GEOCODER_UNAVAILABLE: 503,
  OVERTURE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

const TITLES: Readonly<Record<ErrorCode, string>> = {
  INVALID_COORDINATES: 'Invalid coordinates',
  INVALID_QUERY: 'Invalid request',
  NOT_FOUND: 'Not found',
  RATE_LIMITED: 'Too many requests',
  GEOCODER_RATE_LIMITED: 'Address service busy',
  AREA_FETCH_FAILED: 'Map data could not be fetched',
  OVERTURE_RELEASE_NOT_FOUND: 'Map data release not found',
  GEOCODER_UNAVAILABLE: 'Address service unavailable',
  OVERTURE_UNAVAILABLE: 'Map data source unavailable',
  INTERNAL: 'Internal error',
};

export interface ProblemOptions {
  readonly retryable?: boolean;
  readonly retryAfterSeconds?: number;
  /** Overrides the status from the table (used for framework 4xx errors). */
  readonly status?: number;
}

/** Builds an RFC 9457 problem body for a stable error code. */
export function problemFor(
  code: ErrorCode,
  detail: string,
  requestId: string,
  options: ProblemOptions = {},
): Problem {
  const problem: Problem = {
    type: `urn:geotoon:problem:${code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLES[code],
    status: options.status ?? STATUS_BY_CODE[code],
    detail,
    code,
    retryable: options.retryable ?? false,
    requestId,
  };
  if (options.retryAfterSeconds !== undefined) {
    problem.retryAfterSeconds = options.retryAfterSeconds;
  }
  return problem;
}
