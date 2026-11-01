import type { Clock, Logger } from '../../shared/ports.js';
import { retryDelaySeconds } from '../domain/tile-coverage.js';
import { boundsOfTiles } from '../domain/tile-grid.js';
import type {
  FeatureStore,
  IngestionJob,
  MapDataSource,
  TileCoverageRepository,
} from './ports.js';
import { classifySourceError } from './source-error.js';

export interface IngestTilesDeps {
  readonly source: MapDataSource;
  readonly coverage: TileCoverageRepository;
  readonly store: FeatureStore;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Must stay below the lease length so a slow fetch cannot outlive its claim. */
  readonly timeoutMs: number;
}

/**
 * Fetches the claimed tiles once (one bounding box), then stores the features and marks
 * the tiles complete in one transaction. On failure the tiles are marked failed with a
 * back-off. No transaction is open while the remote fetch runs.
 */
export class IngestTiles {
  constructor(private readonly deps: IngestTilesDeps) {}

  async run(job: IngestionJob): Promise<void> {
    const { source, store, clock, logger } = this.deps;
    const startedAt = clock.now().getTime();
    const fields = { requestId: job.requestId, tiles: job.tiles.length };
    try {
      const batch = await source.fetch(boundsOfTiles(job.tiles), {
        timeoutMs: this.deps.timeoutMs,
      });
      const completed = await store.storeAndComplete(batch, job.tiles, job.owner, job.requestId);
      logger.info('ingestion complete', {
        ...fields,
        completed: completed.length,
        features: batch.features.length,
        release: batch.release,
        durationMs: clock.now().getTime() - startedAt,
      });
    } catch (error) {
      const errorClass = classifySourceError(error);
      await this.markFailed(job, errorClass);
      logger.error('ingestion failed', {
        ...fields,
        errorClass,
        message: error instanceof Error ? error.message : String(error),
        durationMs: clock.now().getTime() - startedAt,
      });
    }
  }

  private async markFailed(job: IngestionJob, errorClass: string): Promise<void> {
    const { coverage, clock } = this.deps;
    const now = clock.now().getTime();
    const current = await coverage.get(job.tiles);
    const failed = current.map((c) => ({
      tile: c.tile,
      retryAfter: new Date(now + retryDelaySeconds(c.attempts) * 1000),
    }));
    await coverage.markFailed(failed, job.owner, errorClass);
  }
}
