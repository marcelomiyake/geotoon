import {
  fromLocal,
  isClaimable,
  missingCoverage,
  tileId,
  type Clock,
  type FailedTile,
  type FeatureBatch,
  type FeatureStore,
  type GeoPoint,
  type IngestionJob,
  type IngestionScheduler,
  type LogFields,
  type Logger,
  type Position,
  type TileCoverage,
  type TileCoverageRepository,
  type TileKey,
} from '../src/index.js';

/** PoC address: Av. Bolonha, 200 - Jaguaré, São Paulo. */
export const POC: GeoPoint = { lat: -23.548_581_7, lon: -46.746_914_4 };

export class FixedClock implements Clock {
  constructor(private current = new Date('2026-11-01T12:00:00Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

export interface LogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields: LogFields | undefined;
}

export class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];

  info(message: string, fields?: LogFields): void {
    this.entries.push({ level: 'info', message, fields });
  }

  warn(message: string, fields?: LogFields): void {
    this.entries.push({ level: 'warn', message, fields });
  }

  error(message: string, fields?: LogFields): void {
    this.entries.push({ level: 'error', message, fields });
  }
}

/** Coverage repository with the same lease rules as the PostGIS adapter. */
export class InMemoryCoverage implements TileCoverageRepository {
  readonly records = new Map<string, TileCoverage>();

  constructor(private readonly clock: Clock) {}

  get(tiles: readonly TileKey[]): Promise<TileCoverage[]> {
    return Promise.resolve(tiles.map((tile) => this.records.get(tileId(tile)) ?? missingCoverage(tile)));
  }

  claim(tiles: readonly TileKey[], owner: string, leaseSeconds: number): Promise<TileKey[]> {
    const now = this.clock.now();
    const claimed: TileKey[] = [];
    for (const tile of tiles) {
      const current = this.records.get(tileId(tile)) ?? missingCoverage(tile);
      if (isClaimable(current, now)) {
        this.records.set(tileId(tile), {
          tile,
          state: 'fetching',
          attempts: current.attempts + 1,
          leaseOwner: owner,
          leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
        });
        claimed.push(tile);
      }
    }
    return Promise.resolve(claimed);
  }

  markFailed(failed: readonly FailedTile[], owner: string, errorClass: string): Promise<void> {
    for (const { tile, retryAfter } of failed) {
      const current = this.records.get(tileId(tile));
      if (current?.state === 'fetching' && current.leaseOwner === owner) {
        this.records.set(tileId(tile), {
          tile,
          state: 'failed',
          attempts: current.attempts,
          errorClass,
          retryAfter,
        });
      }
    }
    return Promise.resolve();
  }

  releaseOwner(owner: string): Promise<number> {
    let released = 0;
    for (const [key, record] of this.records) {
      if (record.state === 'fetching' && record.leaseOwner === owner) {
        this.records.set(key, { tile: record.tile, state: 'missing', attempts: record.attempts });
        released += 1;
      }
    }
    return Promise.resolve(released);
  }

  /** Marks tiles complete when `owner` still holds their lease; returns the completed tiles. */
  complete(tiles: readonly TileKey[], owner: string, release: string, requestId: string): TileKey[] {
    const done: TileKey[] = [];
    for (const tile of tiles) {
      const current = this.records.get(tileId(tile));
      if (current?.state === 'fetching' && current.leaseOwner === owner) {
        this.records.set(tileId(tile), {
          tile,
          state: 'complete',
          attempts: current.attempts,
          release,
          fetchedAt: this.clock.now(),
          fetchRequestId: requestId,
        });
        done.push(tile);
      }
    }
    return done;
  }

  setAll(tiles: readonly TileKey[], record: Omit<TileCoverage, 'tile'>): void {
    for (const tile of tiles) {
      this.records.set(tileId(tile), { ...record, tile });
    }
  }
}

export class InMemoryFeatureStore implements FeatureStore {
  readonly batches: FeatureBatch[] = [];

  constructor(private readonly coverage: InMemoryCoverage) {}

  storeAndComplete(
    batch: FeatureBatch,
    tiles: readonly TileKey[],
    owner: string,
    requestId: string,
  ): Promise<TileKey[]> {
    this.batches.push(batch);
    return Promise.resolve(this.coverage.complete(tiles, owner, batch.release, requestId));
  }
}

export class RecordingScheduler implements IngestionScheduler {
  readonly jobs: IngestionJob[] = [];

  schedule(job: IngestionJob): void {
    this.jobs.push(job);
  }
}

/** `[lon, lat]` of a point `x` metres east and `y` metres north of `origin`. */
export function at(origin: GeoPoint, x: number, y: number): Position {
  return fromLocal(origin, { x, y });
}

/** Closed square ring of side `2 * half` metres centred `cx`, `cy` metres from `origin`. */
export function squareRing(origin: GeoPoint, cx: number, cy: number, half: number): Position[] {
  return [
    at(origin, cx - half, cy - half),
    at(origin, cx + half, cy - half),
    at(origin, cx + half, cy + half),
    at(origin, cx - half, cy + half),
    at(origin, cx - half, cy - half),
  ];
}
