import { DomainError } from '../../shared/domain-error.js';
import type { GeoPoint } from '../../shared/geo-point.js';
import type { Clock } from '../../shared/ports.js';
import type { Scene } from '../domain/scene.js';
import {
  LEASE_SECONDS,
  areaStatus,
  earliestRetry,
  isClaimable,
  type TileCoverage,
  type TileState,
} from '../domain/tile-coverage.js';
import { tilesCovering, type TileKey } from '../domain/tile-grid.js';
import type { IngestionScheduler, TileCoverageRepository } from './ports.js';
import type { ReadScene } from './read-scene.js';

export interface TileStatusView {
  readonly tile: TileKey;
  readonly state: TileState;
  readonly fetchedAt?: Date;
  readonly release?: string;
}

export type AreaResult =
  | {
      readonly status: 'ready';
      readonly tiles: TileStatusView[];
      readonly sourceCalls: number;
      readonly scene: Scene;
    }
  | { readonly status: 'pending'; readonly tiles: TileStatusView[]; readonly sourceCalls: number };

export interface RequestAreaDeps {
  readonly coverage: TileCoverageRepository;
  readonly scheduler: IngestionScheduler;
  readonly readScene: ReadScene;
  readonly clock: Clock;
  /** Identifies this process in leases. */
  readonly owner: string;
  readonly radiusM: number;
  readonly leaseSeconds?: number;
}

/**
 * The idempotent "ensure this area" use case. Returns the scene when every covering
 * tile is stored; otherwise claims the missing tiles, schedules one fetch for them, and
 * reports progress. `sourceCalls` is the number of source fetches this call started.
 */
export class RequestArea {
  constructor(private readonly deps: RequestAreaDeps) {}

  async execute(centre: GeoPoint, requestId: string): Promise<AreaResult> {
    const { coverage, clock, radiusM } = this.deps;
    const tiles = tilesCovering(centre, radiusM);
    const coverages = await coverage.get(tiles);
    const now = clock.now();
    const status = areaStatus(coverages, now);

    if (status === 'ready') {
      const scene = await this.deps.readScene.execute(centre, radiusM);
      return { status, tiles: coverages.map(toView), sourceCalls: 0, scene };
    }
    if (status === 'failed') {
      throw fetchFailed(coverages, now);
    }

    const claimable = coverages.filter((c) => isClaimable(c, now)).map((c) => c.tile);
    const sourceCalls = await this.claimAndSchedule(claimable, requestId);
    const latest = sourceCalls > 0 ? await coverage.get(tiles) : coverages;
    return { status: 'pending', tiles: latest.map(toView), sourceCalls };
  }

  private async claimAndSchedule(claimable: TileKey[], requestId: string): Promise<number> {
    if (claimable.length === 0) {
      return 0;
    }
    const { coverage, scheduler, owner } = this.deps;
    const claimed = await coverage.claim(claimable, owner, this.deps.leaseSeconds ?? LEASE_SECONDS);
    if (claimed.length === 0) {
      return 0;
    }
    scheduler.schedule({ tiles: claimed, owner, requestId });
    return 1;
  }
}

function toView(coverage: TileCoverage): TileStatusView {
  return {
    tile: coverage.tile,
    state: coverage.state,
    fetchedAt: coverage.fetchedAt,
    release: coverage.release,
  };
}

function fetchFailed(coverages: readonly TileCoverage[], now: Date): DomainError {
  const retryAt = earliestRetry(coverages);
  const retryAfterSeconds = retryAt
    ? Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000))
    : undefined;
  const failed = coverages.filter((c) => c.state === 'failed');
  const errorClass = failed[0]?.errorClass ?? 'unknown';
  return new DomainError(
    'AREA_FETCH_FAILED',
    `Map data for ${failed.length} tile(s) could not be fetched (${errorClass}).`,
    { retryable: true, retryAfterSeconds },
  );
}
