import type { TileKey } from './tile-grid.js';

export type TileState = 'missing' | 'fetching' | 'complete' | 'failed';

/** Coverage record of one tile: whether its features are stored, and fetch bookkeeping. */
export interface TileCoverage {
  readonly tile: TileKey;
  readonly state: TileState;
  readonly attempts: number;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: Date;
  readonly errorClass?: string;
  readonly retryAfter?: Date;
  readonly release?: string;
  readonly featureCount?: number;
  readonly fetchedAt?: Date;
  readonly fetchRequestId?: string;
}

/** How long a claim is valid. Longer than the source query timeout (120 s). */
export const LEASE_SECONDS = 180;
const RETRY_BASE_SECONDS = 10;
const RETRY_MAX_SECONDS = 600;

export type AreaStatus = 'ready' | 'pending' | 'failed';

export function missingCoverage(tile: TileKey): TileCoverage {
  return { tile, state: 'missing', attempts: 0 };
}

/** Whether a new fetch may take this tile now. */
export function isClaimable(coverage: TileCoverage, now: Date): boolean {
  switch (coverage.state) {
    case 'missing':
      return true;
    case 'failed':
      return coverage.retryAfter === undefined || coverage.retryAfter <= now;
    case 'fetching':
      return coverage.leaseExpiresAt === undefined || coverage.leaseExpiresAt < now;
    case 'complete':
      return false;
  }
}

/** Exponential back-off after `attempts` failed fetches: 20 s, 40 s, ... capped at 10 min. */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(RETRY_BASE_SECONDS * 2 ** Math.max(0, attempts), RETRY_MAX_SECONDS);
}

/**
 * `ready` when every tile is complete; `failed` when a tile failed and may not be
 * retried yet; otherwise `pending`.
 */
export function areaStatus(coverages: readonly TileCoverage[], now: Date): AreaStatus {
  if (coverages.every((c) => c.state === 'complete')) {
    return 'ready';
  }
  const blocked = coverages.some((c) => c.state === 'failed' && !isClaimable(c, now));
  return blocked ? 'failed' : 'pending';
}

/** Earliest retry time among failed tiles, if any. */
export function earliestRetry(coverages: readonly TileCoverage[]): Date | undefined {
  let earliest: Date | undefined;
  for (const coverage of coverages) {
    if (coverage.state === 'failed' && coverage.retryAfter !== undefined) {
      if (earliest === undefined || coverage.retryAfter < earliest) {
        earliest = coverage.retryAfter;
      }
    }
  }
  return earliest;
}
