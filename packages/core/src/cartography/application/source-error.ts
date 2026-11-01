export type SourceErrorClass =
  | 'timeout'
  | 'network'
  | 'release_not_found'
  | 'parse_error'
  | 'unknown';

/** A classified failure raised by a {@link MapDataSource} adapter. */
export class SourceError extends Error {
  readonly errorClass: SourceErrorClass;

  constructor(errorClass: SourceErrorClass, message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'SourceError';
    this.errorClass = errorClass;
  }
}

export function classifySourceError(error: unknown): SourceErrorClass {
  return error instanceof SourceError ? error.errorClass : 'unknown';
}
