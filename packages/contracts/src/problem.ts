import { z } from 'zod';

export const ERROR_CODES = [
  'INVALID_COORDINATES',
  'INVALID_QUERY',
  'GEOCODER_UNAVAILABLE',
  'GEOCODER_RATE_LIMITED',
  'OVERTURE_UNAVAILABLE',
  'OVERTURE_RELEASE_NOT_FOUND',
  'AREA_FETCH_FAILED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'INTERNAL',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);

/** RFC 9457 Problem Details plus stable GeoToon fields. Media type: application/problem+json. */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  code: ErrorCodeSchema,
  retryable: z.boolean(),
  retryAfterSeconds: z.number().int().positive().optional(),
  requestId: z.string(),
});

export const PROBLEM_MEDIA_TYPE = 'application/problem+json';

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type Problem = z.infer<typeof ProblemSchema>;
