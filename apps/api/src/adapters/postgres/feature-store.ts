import type pg from 'pg';
import {
  HEIGHT_RULE_VERSION,
  TILE_ZOOM,
  boundsOf,
  compareTiles,
  type FeatureBatch,
  type FeatureStore,
  type IngestFeature,
  type TileKey,
} from '@geotoon/core';

/** Rows per INSERT statement. */
export const UPSERT_BATCH_SIZE = 1000;

// Polygonal layers keep only polygons after repair, lines only lines; empty results are skipped.
const UPSERT = `
  INSERT INTO map_feature (id, layer, kind, geom, height_m, num_floors, min_height_m, name,
                           source_dataset, source_record_id, overture_release, attrs)
  SELECT f.id, f.layer, f.kind, g.geom, f.height_m, f.num_floors, f.min_height_m, f.name,
         f.source_dataset, f.source_record_id, $12, f.attrs
  FROM unnest($1::text[], $2::text[], $3::text[], $4::bytea[], $5::real[], $6::smallint[],
              $7::real[], $8::text[], $9::text[], $10::text[], $11::jsonb[])
       AS f(id, layer, kind, wkb, height_m, num_floors, min_height_m, name,
            source_dataset, source_record_id, attrs)
  CROSS JOIN LATERAL (
    SELECT CASE f.layer
             WHEN 'building' THEN ST_CollectionExtract(ST_MakeValid(ST_GeomFromWKB(f.wkb, 4326)), 3)
             WHEN 'area'     THEN ST_CollectionExtract(ST_MakeValid(ST_GeomFromWKB(f.wkb, 4326)), 3)
             WHEN 'line'     THEN ST_CollectionExtract(ST_MakeValid(ST_GeomFromWKB(f.wkb, 4326)), 2)
             ELSE ST_GeomFromWKB(f.wkb, 4326)
           END AS geom
  ) AS g
  WHERE NOT ST_IsEmpty(g.geom)
  ON CONFLICT (id) DO UPDATE
    SET layer = EXCLUDED.layer, kind = EXCLUDED.kind, geom = EXCLUDED.geom,
        height_m = EXCLUDED.height_m, num_floors = EXCLUDED.num_floors,
        min_height_m = EXCLUDED.min_height_m, name = EXCLUDED.name,
        source_dataset = EXCLUDED.source_dataset, source_record_id = EXCLUDED.source_record_id,
        overture_release = EXCLUDED.overture_release, attrs = EXCLUDED.attrs,
        ingested_at = now()`;

const COMPLETE = `
  UPDATE tile_coverage t
     SET state = 'complete', lease_owner = NULL, lease_expires_at = NULL,
         error_class = NULL, retry_after = NULL, overture_release = $5,
         fetched_at = now(), fetch_request_id = $6, ingest_version = $7,
         feature_count = (SELECT count(*) FROM map_feature m
                           WHERE m.geom && ST_MakeEnvelope(k.w, k.s, k.e, k.n, 4326))
    FROM unnest($2::int[], $3::int[], $8::float8[], $9::float8[], $10::float8[], $11::float8[])
         AS k(x, y, w, s, e, n)
   WHERE t.z = $1 AND t.x = k.x AND t.y = k.y
     AND t.lease_owner = $4 AND t.state = 'fetching'
  RETURNING t.x, t.y`;

/** Writes a fetched batch and completes the tiles this owner still holds, atomically. */
export class PgFeatureStore implements FeatureStore {
  constructor(private readonly pool: pg.Pool) {}

  async storeAndComplete(
    batch: FeatureBatch,
    tiles: readonly TileKey[],
    owner: string,
    requestId: string,
  ): Promise<TileKey[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const unique = dedupeById(batch.features);
      for (let start = 0; start < unique.length; start += UPSERT_BATCH_SIZE) {
        const chunk = unique.slice(start, start + UPSERT_BATCH_SIZE);
        await client.query(UPSERT, [...featureColumns(chunk), batch.release]);
      }
      const completed = await client.query<{ x: number; y: number }>(
        COMPLETE,
        completionParams(tiles, owner, batch.release, requestId),
      );
      await client.query('COMMIT');
      return completed.rows.map((row) => ({ x: row.x, y: row.y })).sort(compareTiles);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function dedupeById(features: readonly IngestFeature[]): IngestFeature[] {
  return [...new Map(features.map((f) => [f.id, f])).values()];
}

function featureColumns(chunk: readonly IngestFeature[]): unknown[] {
  return [
    chunk.map((f) => f.id),
    chunk.map((f) => f.layer),
    chunk.map((f) => f.kind),
    chunk.map((f) => Buffer.from(f.geometryWkb)),
    chunk.map((f) => f.heightM ?? null),
    chunk.map((f) => f.numFloors ?? null),
    chunk.map((f) => f.minHeightM ?? null),
    chunk.map((f) => f.name ?? null),
    chunk.map((f) => f.sourceDataset),
    chunk.map((f) => f.sourceRecordId ?? null),
    chunk.map((f) => JSON.stringify(f.attrs)),
  ];
}

function completionParams(
  tiles: readonly TileKey[],
  owner: string,
  release: string,
  requestId: string,
): unknown[] {
  const bounds = tiles.map(boundsOf);
  return [
    TILE_ZOOM,
    tiles.map((t) => t.x),
    tiles.map((t) => t.y),
    owner,
    release,
    requestId,
    HEIGHT_RULE_VERSION,
    bounds.map((b) => b.west),
    bounds.map((b) => b.south),
    bounds.map((b) => b.east),
    bounds.map((b) => b.north),
  ];
}
