/** Source of the current time, injected so rules that depend on time stay testable. */
export interface Clock {
  now(): Date;
}

export type LogFields = Readonly<Record<string, unknown>>;

/** Structured logger port. Adapters must not log response bodies or raw addresses. */
export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}
