import { Writable } from 'node:stream';
import type { IngestionJob, LogFields, Logger } from '@geotoon/core';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { InProcessScheduler } from '../../src/adapters/ingestion/in-process-scheduler.js';
import { PinoLogger } from '../../src/adapters/system/pino-logger.js';
import { systemClock } from '../../src/adapters/system/system-clock.js';

const job = (requestId: string): IngestionJob => ({ tiles: [{ x: 1, y: 1 }], owner: 'owner', requestId });

class ListLogger implements Logger {
  readonly errors: Array<{ message: string; fields: LogFields | undefined }> = [];
  info(): void {}
  warn(): void {}
  error(message: string, fields?: LogFields): void {
    this.errors.push({ message, fields });
  }
}

describe('InProcessScheduler', () => {
  it('runs jobs one at a time, in arrival order', async () => {
    const started: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const scheduler = new InProcessScheduler(async (j) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      started.push(j.requestId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    }, new ListLogger());

    scheduler.schedule(job('a'));
    scheduler.schedule(job('b'));
    scheduler.schedule(job('c'));
    expect(scheduler.pending).toBe(2);
    await scheduler.drain();

    expect(started).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
    expect(scheduler.pending).toBe(0);
  });

  it('logs a crashed job and keeps going', async () => {
    const logger = new ListLogger();
    const done: string[] = [];
    const scheduler = new InProcessScheduler((j) => {
      if (j.requestId === 'bad') {
        return Promise.reject(new Error('disk full'));
      }
      done.push(j.requestId);
      return Promise.resolve();
    }, logger);

    scheduler.schedule(job('bad'));
    scheduler.schedule(job('good'));
    await scheduler.drain();

    expect(done).toEqual(['good']);
    expect(logger.errors).toEqual([
      { message: 'ingestion job crashed', fields: { requestId: 'bad', message: 'disk full' } },
    ]);
  });

  it('starts again after the queue empties', async () => {
    const done: string[] = [];
    const scheduler = new InProcessScheduler((j) => {
      done.push(j.requestId);
      return Promise.resolve();
    }, new ListLogger());
    scheduler.schedule(job('first'));
    await scheduler.drain();
    scheduler.schedule(job('second'));
    await scheduler.drain();
    expect(done).toEqual(['first', 'second']);
  });
});

describe('system adapters', () => {
  it('passes fields first and the message second to pino', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = new PinoLogger(pino({ base: undefined, timestamp: false }, sink));
    logger.info('ingestion complete', { tiles: 3 });
    logger.warn('slow');
    logger.error('ingestion failed', { errorClass: 'timeout' });
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { level: 30, tiles: 3, msg: 'ingestion complete' },
      { level: 40, msg: 'slow' },
      { level: 50, errorClass: 'timeout', msg: 'ingestion failed' },
    ]);
  });

  it('reads the wall clock', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
