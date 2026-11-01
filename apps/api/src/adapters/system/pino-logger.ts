import type { LogFields, Logger } from '@geotoon/core';
import type { Logger as Pino } from 'pino';

/** Adapts pino to the core `Logger` port (fields first, message second). */
export class PinoLogger implements Logger {
  constructor(private readonly pino: Pino) {}

  info(message: string, fields: LogFields = {}): void {
    this.pino.info(fields, message);
  }

  warn(message: string, fields: LogFields = {}): void {
    this.pino.warn(fields, message);
  }

  error(message: string, fields: LogFields = {}): void {
    this.pino.error(fields, message);
  }
}
