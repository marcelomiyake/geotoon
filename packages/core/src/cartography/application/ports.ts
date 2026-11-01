import type { GeoPoint } from '../../shared/geo-point.js';
import type {
  FeatureBatch,
  MapArea,
  MapLine,
  StoredBuilding,
  TreeFeature,
} from '../domain/features.js';
import type { TileCoverage } from '../domain/tile-coverage.js';
import type { Bounds, TileKey } from '../domain/tile-grid.js';
import type { TerrainGrid } from '../domain/terrain.js';

/** Optional bare-earth elevations. An unavailable source returns undefined, preserving flat maps. */
export interface TerrainReader {
  readWithin(centre: GeoPoint, radiusM: number): Promise<TerrainGrid | undefined>;
}

export interface FetchOptions {
  /** The adapter must give up and throw a `SourceError('timeout')` after this long. */
  readonly timeoutMs: number;
}

/** Port to the open map data source (Overture). One call fetches every layer in `bounds`. */
export interface MapDataSource {
  fetch(bounds: Bounds, options: FetchOptions): Promise<FeatureBatch>;
}

export interface FailedTile {
  readonly tile: TileKey;
  readonly retryAfter: Date;
}

/** Port to the per-tile coverage state. Every write is conditional on the lease owner. */
export interface TileCoverageRepository {
  /** One record per requested tile; tiles never seen are returned as `missing`. */
  get(tiles: readonly TileKey[]): Promise<TileCoverage[]>;
  /** Atomically takes the claimable tiles for `owner`; returns the ones it took. */
  claim(tiles: readonly TileKey[], owner: string, leaseSeconds: number): Promise<TileKey[]>;
  markFailed(failed: readonly FailedTile[], owner: string, errorClass: string): Promise<void>;
  /** Hands every lease held by `owner` back for immediate retry (used on shutdown). */
  releaseOwner(owner: string): Promise<number>;
}

/** Port that stores a fetched batch and marks tiles complete in one transaction. */
export interface FeatureStore {
  storeAndComplete(
    batch: FeatureBatch,
    tiles: readonly TileKey[],
    owner: string,
    requestId: string,
  ): Promise<TileKey[]>;
}

export interface StoredFeatures {
  readonly buildings: readonly StoredBuilding[];
  readonly lines: readonly MapLine[];
  readonly areas: readonly MapArea[];
  readonly trees: readonly TreeFeature[];
  /** Distinct source datasets of the returned features, for attribution. */
  readonly datasets: readonly string[];
}

/** Port that reads stored features whose geometry lies within `radiusM` of `centre`. */
export interface FeatureReader {
  readWithin(centre: GeoPoint, radiusM: number): Promise<StoredFeatures>;
}

export interface IngestionJob {
  readonly tiles: readonly TileKey[];
  readonly owner: string;
  readonly requestId: string;
}

/** Port that runs ingestion outside the lifetime of the HTTP request that triggered it. */
export interface IngestionScheduler {
  schedule(job: IngestionJob): void;
}
