import type { IngestionJob, IngestionScheduler, Logger } from '@geotoon/core';

export type JobRunner = (job: IngestionJob) => Promise<void>;

/**
 * Runs ingestion jobs one at a time, in arrival order, detached from the HTTP request.
 * One run at a time keeps DuckDB memory and Overture traffic bounded (PD1 = A).
 */
export class InProcessScheduler implements IngestionScheduler {
  private readonly queue: IngestionJob[] = [];
  private running: Promise<void> | undefined;

  constructor(
    private readonly runner: JobRunner,
    private readonly logger: Logger,
  ) {}

  schedule(job: IngestionJob): void {
    this.queue.push(job);
    this.running ??= this.drainQueue();
  }

  /** Number of jobs waiting, not counting the one in progress. */
  get pending(): number {
    return this.queue.length;
  }

  /** Resolves when every queued job has finished. */
  async drain(): Promise<void> {
    const running = this.running;
    if (running !== undefined) {
      await running;
      await this.drain();
    }
  }

  private async drainQueue(): Promise<void> {
    try {
      await this.runQueued();
    } finally {
      this.running = undefined;
    }
  }

  /** Runs queued jobs one after another until the queue is empty. */
  private async runQueued(): Promise<void> {
    const job = this.queue.shift();
    if (job === undefined) {
      return;
    }
    try {
      await this.runner(job);
    } catch (error) {
      this.logger.error('ingestion job crashed', {
        requestId: job.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await this.runQueued();
  }
}
