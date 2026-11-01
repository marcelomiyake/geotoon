import type pg from 'pg';
import {
  TILE_ZOOM,
  compareTiles,
  missingCoverage,
  type FailedTile,
  type TileCoverage,
  type TileCoverageRepository,
  type TileKey,
  type TileState,
} from '@geotoon/core';

interface CoverageRow {
  x: number;
  y: number;
  state: TileState;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  attempts: number;
  error_class: string | null;
  retry_after: Date | null;
  overture_release: string | null;
  feature_count: number | null;
  fetched_at: Date | null;
  fetch_request_id: string | null;
}

const SELECT_COVERAGE = `
  SELECT t.x, t.y, t.state, t.lease_owner, t.lease_expires_at, t.attempts, t.error_class,
         t.retry_after, t.overture_release, t.feature_count, t.fetched_at, t.fetch_request_id
  FROM tile_coverage t
  JOIN unnest($2::int[], $3::int[]) AS k(x, y) ON t.x = k.x AND t.y = k.y
  WHERE t.z = $1`;

const CLAIM = `
  INSERT INTO tile_coverage (z, x, y, state, lease_owner, lease_expires_at, attempts)
  SELECT $1, k.x, k.y, 'fetching', $4, now() + make_interval(secs => $5), 1
  FROM unnest($2::int[], $3::int[]) AS k(x, y)
  ORDER BY k.x, k.y
  ON CONFLICT (z, x, y) DO UPDATE
    SET state = 'fetching',
        lease_owner = EXCLUDED.lease_owner,
        lease_expires_at = EXCLUDED.lease_expires_at,
        attempts = tile_coverage.attempts + 1,
        error_class = NULL
    WHERE tile_coverage.state = 'missing'
       OR (tile_coverage.state = 'failed'
           AND (tile_coverage.retry_after IS NULL OR tile_coverage.retry_after <= now()))
       OR (tile_coverage.state = 'fetching'
           AND (tile_coverage.lease_expires_at IS NULL OR tile_coverage.lease_expires_at < now()))
  RETURNING x, y`;

const MARK_FAILED = `
  UPDATE tile_coverage t
     SET state = 'failed', error_class = $5, retry_after = k.retry_after,
         lease_owner = NULL, lease_expires_at = NULL
    FROM unnest($2::int[], $3::int[], $6::timestamptz[]) AS k(x, y, retry_after)
   WHERE t.z = $1 AND t.x = k.x AND t.y = k.y
     AND t.lease_owner = $4 AND t.state = 'fetching'`;

const RELEASE_OWNER = `
  UPDATE tile_coverage
     SET state = 'failed', error_class = 'interrupted', retry_after = now(),
         lease_owner = NULL, lease_expires_at = NULL
   WHERE lease_owner = $1 AND state = 'fetching'`;

/** Coverage state in PostgreSQL. Claims are atomic, so only one process fetches a tile. */
export class PgTileCoverageRepository implements TileCoverageRepository {
  constructor(private readonly pool: pg.Pool) {}

  async get(tiles: readonly TileKey[]): Promise<TileCoverage[]> {
    const { xs, ys } = columns(tiles);
    const result = await this.pool.query<CoverageRow>(SELECT_COVERAGE, [TILE_ZOOM, xs, ys]);
    const byKey = new Map(result.rows.map((row) => [`${row.x}/${row.y}`, toCoverage(row)]));
    return tiles.map((tile) => byKey.get(`${tile.x}/${tile.y}`) ?? missingCoverage(tile));
  }

  async claim(tiles: readonly TileKey[], owner: string, leaseSeconds: number): Promise<TileKey[]> {
    if (tiles.length === 0) {
      return [];
    }
    const { xs, ys } = columns([...tiles].sort(compareTiles));
    const result = await this.pool.query<{ x: number; y: number }>(CLAIM, [
      TILE_ZOOM,
      xs,
      ys,
      owner,
      leaseSeconds,
    ]);
    return result.rows.map((row) => ({ x: row.x, y: row.y })).sort(compareTiles);
  }

  async markFailed(failed: readonly FailedTile[], owner: string, errorClass: string): Promise<void> {
    if (failed.length === 0) {
      return;
    }
    const { xs, ys } = columns(failed.map((f) => f.tile));
    const retryAfter = failed.map((f) => f.retryAfter);
    await this.pool.query(MARK_FAILED, [TILE_ZOOM, xs, ys, owner, errorClass, retryAfter]);
  }

  async releaseOwner(owner: string): Promise<number> {
    const result = await this.pool.query(RELEASE_OWNER, [owner]);
    return result.rowCount ?? 0;
  }
}

function columns(tiles: readonly TileKey[]): { xs: number[]; ys: number[] } {
  return { xs: tiles.map((t) => t.x), ys: tiles.map((t) => t.y) };
}

function toCoverage(row: CoverageRow): TileCoverage {
  return {
    tile: { x: row.x, y: row.y },
    state: row.state,
    attempts: row.attempts,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    errorClass: row.error_class ?? undefined,
    retryAfter: row.retry_after ?? undefined,
    release: row.overture_release ?? undefined,
    featureCount: row.feature_count ?? undefined,
    fetchedAt: row.fetched_at ?? undefined,
    fetchRequestId: row.fetch_request_id ?? undefined,
  };
}
