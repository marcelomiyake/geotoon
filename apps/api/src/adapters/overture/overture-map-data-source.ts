import {
  SourceError,
  type Bounds,
  type FeatureBatch,
  type FetchOptions,
  type IngestFeature,
  type MapDataSource,
} from '@geotoon/core';
import type { DuckDbClient, DuckRow } from './duckdb-client.js';
import { QueryAbortedError } from './duckdb-client.js';
import {
  LAND_SUBTYPES,
  mapBuilding,
  mapLand,
  mapLandUse,
  mapSegment,
  mapWater,
  type BuildingRow,
  type OvertureRow,
  type SegmentRow,
} from './overture-mapping.js';

export interface OvertureConfig {
  /** `s3://overturemaps-us-west-2/release` in production, a local directory in tests. */
  readonly baseUrl: string;
  readonly release: string;
}

// Every statement is static; the parquet path and the bbox are positional parameters.
const BBOX_FILTER = 'bbox.xmin < ? AND bbox.xmax > ? AND bbox.ymin < ? AND bbox.ymax > ?';
const COMMON = 'id, geometry, subtype, class, sources[1].dataset AS dataset, sources[1].record_id AS record_id';
const FROM = 'FROM read_parquet(?, hive_partitioning = 1)';

const BUILDINGS_SQL = `SELECT ${COMMON}, height, num_floors, min_height ${FROM} WHERE ${BBOX_FILTER}`;
const SEGMENTS_SQL = `SELECT ${COMMON}, names.primary AS name ${FROM} WHERE ${BBOX_FILTER}`;
const BASE_SQL = `SELECT ${COMMON} ${FROM} WHERE ${BBOX_FILTER}`;
const LAND_SQL = `SELECT ${COMMON} ${FROM} WHERE ${BBOX_FILTER} AND subtype IN (${LAND_SUBTYPES.map(() => '?').join(', ')})`;

interface LayerQuery {
  readonly theme: string;
  readonly type: string;
  readonly sql: string;
  readonly extraParams: readonly string[];
  readonly map: (row: DuckRow) => IngestFeature | undefined;
}

const QUERIES: readonly LayerQuery[] = [
  {
    theme: 'buildings',
    type: 'building',
    sql: BUILDINGS_SQL,
    extraParams: [],
    map: (row) => mapBuilding(toBuildingRow(row)),
  },
  {
    theme: 'transportation',
    type: 'segment',
    sql: SEGMENTS_SQL,
    extraParams: [],
    map: (row) => mapSegment(toSegmentRow(row)),
  },
  { theme: 'base', type: 'land_use', sql: BASE_SQL, extraParams: [], map: (row) => mapLandUse(toRow(row)) },
  { theme: 'base', type: 'water', sql: BASE_SQL, extraParams: [], map: (row) => mapWater(toRow(row)) },
  {
    theme: 'base',
    type: 'land',
    sql: LAND_SQL,
    extraParams: LAND_SUBTYPES,
    map: (row) => mapLand(toRow(row)),
  },
];

/** `MapDataSource` over Overture GeoParquet, read with DuckDB and `httpfs`. */
export class OvertureMapDataSource implements MapDataSource {
  constructor(
    private readonly duck: DuckDbClient,
    private readonly config: OvertureConfig,
  ) {}

  async fetch(bounds: Bounds, options: FetchOptions): Promise<FeatureBatch> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('timeout'));
    }, options.timeoutMs);
    try {
      const layers = await Promise.all(
        QUERIES.map((query) => this.runLayer(query, bounds, controller.signal)),
      );
      return { release: this.config.release, features: layers.flat() };
    } catch (error) {
      controller.abort(new Error('sibling query failed'));
      throw toSourceError(error, controller.signal.reason);
    } finally {
      clearTimeout(timer);
    }
  }

  pathFor(theme: string, type: string): string {
    return `${this.config.baseUrl}/${this.config.release}/theme=${theme}/type=${type}/*`;
  }

  private async runLayer(
    query: LayerQuery,
    bounds: Bounds,
    signal: AbortSignal,
  ): Promise<IngestFeature[]> {
    const params = [
      this.pathFor(query.theme, query.type),
      bounds.east,
      bounds.west,
      bounds.north,
      bounds.south,
      ...query.extraParams,
    ];
    const rows = await this.duck.query(query.sql, params, signal);
    const features: IngestFeature[] = [];
    for (const row of rows) {
      const feature = query.map(row);
      if (feature !== undefined) {
        features.push(feature);
      }
    }
    return features;
  }
}

function toSourceError(error: unknown, abortReason: unknown): SourceError {
  if (error instanceof SourceError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof QueryAbortedError) {
    const timedOut = abortReason instanceof Error && abortReason.message === 'timeout';
    return new SourceError(timedOut ? 'timeout' : 'unknown', 'Overture query interrupted', {
      cause: error,
    });
  }
  if (message.includes('No files found that match the pattern')) {
    return new SourceError('release_not_found', 'Overture release path not found', { cause: error });
  }
  if (/HTTP|IO Error|Could not establish connection|Connection/i.test(message)) {
    return new SourceError('network', 'Overture data could not be read', { cause: error });
  }
  if (/parquet|Conversion Error|Binder Error/i.test(message)) {
    return new SourceError('parse_error', 'Overture data had an unexpected shape', { cause: error });
  }
  return new SourceError('unknown', 'Overture query failed', { cause: error });
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  return typeof value === 'bigint' ? Number(value) : null;
}

function toRow(row: DuckRow): OvertureRow {
  const geometry = row['geometry'];
  return {
    id: str(row['id']) ?? '',
    geometry: geometry instanceof Uint8Array ? geometry : new Uint8Array(),
    subtype: str(row['subtype']),
    class: str(row['class']),
    dataset: str(row['dataset']),
    recordId: str(row['record_id']),
  };
}

function toBuildingRow(row: DuckRow): BuildingRow {
  return {
    ...toRow(row),
    height: num(row['height']),
    numFloors: num(row['num_floors']),
    minHeight: num(row['min_height']),
  };
}

function toSegmentRow(row: DuckRow): SegmentRow {
  return { ...toRow(row), name: str(row['name']) };
}
