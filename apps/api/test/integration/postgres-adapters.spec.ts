import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  boundsOf,
  boundsOfTiles,
  fromLocal,
  tileOf,
  tilesCovering,
  type FeatureBatch,
  type IngestFeature,
  type Logger,
  type TileKey,
} from '@geotoon/core';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { DuckDbClient } from '../../src/adapters/overture/duckdb-client.js';
import { OvertureMapDataSource } from '../../src/adapters/overture/overture-map-data-source.js';
import { PgFeatureReader } from '../../src/adapters/postgres/feature-reader.js';
import { PgFeatureStore } from '../../src/adapters/postgres/feature-store.js';
import { migrate } from '../../src/adapters/postgres/migrator.js';
import { PgTileCoverageRepository } from '../../src/adapters/postgres/tile-coverage-repository.js';
import { DEFAULT_MIGRATIONS_DIR } from '../../src/composition-root.js';
import { FIXTURE_RELEASE, OVERTURE_FIXTURE, POC, openDuck } from '../support.js';
import { silentLogger, startPostgis, type Postgis } from './postgis.js';

let postgis: Postgis;
let pool: pg.Pool;
let duck: DuckDbClient;

beforeAll(async () => {
  postgis = await startPostgis();
  pool = postgis.pool();
  await migrate(pool, DEFAULT_MIGRATIONS_DIR, silentLogger);
  duck = await openDuck(inject('duckdbExtensionDir'));
});

afterAll(async () => {
  duck?.close();
  await postgis?.stop();
});

async function truncate(): Promise<void> {
  await pool.query('TRUNCATE map_feature, tile_coverage');
}

describe('migrator', () => {
  it('applies the schema once and is idempotent', async () => {
    await pool.query('CREATE DATABASE migrate_fresh');
    const fresh = postgis.pool('migrate_fresh');
    const first = await migrate(fresh, DEFAULT_MIGRATIONS_DIR, silentLogger);
    const second = await migrate(fresh, DEFAULT_MIGRATIONS_DIR, silentLogger);
    expect(first).toEqual({ applied: [1], databaseVersion: 1, codeVersion: 1 });
    expect(second).toEqual({ applied: [], databaseVersion: 1, codeVersion: 1 });
    const tables = await fresh.query<{ t: string }>(
      "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
    );
    expect(tables.rows.map((r) => r.t)).toEqual(['map_feature', 'schema_migrations', 'spatial_ref_sys', 'tile_coverage']);
  });

  it('serialises two concurrent runs with the advisory lock', async () => {
    await pool.query('CREATE DATABASE migrate_race');
    const results = await Promise.all([
      migrate(postgis.pool('migrate_race'), DEFAULT_MIGRATIONS_DIR, silentLogger),
      migrate(postgis.pool('migrate_race'), DEFAULT_MIGRATIONS_DIR, silentLogger),
    ]);
    expect(results.flatMap((r) => r.applied)).toEqual([1]);
  });

  it('rolls back a failing migration and leaves it unrecorded', async () => {
    await pool.query('CREATE DATABASE migrate_broken');
    const broken = postgis.pool('migrate_broken');
    const directory = mkdtempSync(path.join(tmpdir(), 'geotoon-migrations-'));
    writeFileSync(path.join(directory, '0001_ok.sql'), 'CREATE TABLE first_table (id int);');
    writeFileSync(path.join(directory, '0002_broken.sql'), 'CREATE TABLE second_table (id int); SELECT * FROM missing_table;');
    writeFileSync(path.join(directory, 'README.txt'), 'not a migration');

    await expect(migrate(broken, directory, silentLogger)).rejects.toThrow('Migration 0002_broken.sql failed');
    const versions = await broken.query<{ version: number }>('SELECT version FROM schema_migrations');
    expect(versions.rows).toEqual([{ version: 1 }]);
    const second = await broken.query("SELECT to_regclass('second_table') AS t");
    expect(second.rows[0]).toEqual({ t: null });
  });

  it('runs in rollback mode when the database is ahead of the code', async () => {
    await pool.query('CREATE DATABASE migrate_ahead');
    const ahead = postgis.pool('migrate_ahead');
    await migrate(ahead, DEFAULT_MIGRATIONS_DIR, silentLogger);
    await ahead.query('INSERT INTO schema_migrations (version) VALUES (99)');
    const warnings: string[] = [];
    const logger: Logger = { ...silentLogger, warn: (message) => warnings.push(message) };
    const result = await migrate(ahead, DEFAULT_MIGRATIONS_DIR, logger);
    expect(result).toEqual({ applied: [], databaseVersion: 99, codeVersion: 1 });
    expect(warnings).toEqual(['database schema is newer than this build; running in rollback mode']);
  });
});

describe('PgTileCoverageRepository', () => {
  const tiles: TileKey[] = [
    { x: 100, y: 200 },
    { x: 100, y: 201 },
    { x: 101, y: 200 },
    { x: 101, y: 201 },
  ];
  let coverage: PgTileCoverageRepository;

  beforeEach(async () => {
    await truncate();
    coverage = new PgTileCoverageRepository(pool);
  });

  it('reports unknown tiles as missing', async () => {
    expect((await coverage.get(tiles)).map((c) => c.state)).toEqual(['missing', 'missing', 'missing', 'missing']);
  });

  it('gives each tile to exactly one of two racing owners', async () => {
    const [a, b] = await Promise.all([coverage.claim(tiles, 'owner-a', 180), coverage.claim([...tiles].reverse(), 'owner-b', 180)]);
    expect(a.length + b.length).toBe(tiles.length);
    const key = (t: TileKey): string => `${t.x}/${t.y}`;
    const byKey = (p: string, q: string): number => p.localeCompare(q);
    expect([...a, ...b].map(key).sort(byKey)).toEqual(tiles.map(key).sort(byKey));
    const owners = (await coverage.get(tiles)).map((c) => c.leaseOwner);
    expect(new Set(owners).size).toBeLessThanOrEqual(2);
    expect(owners.every((o) => o === 'owner-a' || o === 'owner-b')).toBe(true);
  });

  it('lets another owner re-claim an expired lease', async () => {
    await coverage.claim(tiles, 'crashed', -1);
    const reclaimed = await coverage.claim(tiles, 'owner-b', 180);
    expect(reclaimed).toEqual(tiles);
    expect((await coverage.get(tiles)).every((c) => c.leaseOwner === 'owner-b' && c.attempts === 2)).toBe(true);
  });

  it('does not re-claim a live lease', async () => {
    await coverage.claim(tiles, 'owner-a', 180);
    expect(await coverage.claim(tiles, 'owner-b', 180)).toEqual([]);
  });

  it('holds failed tiles until their retry time', async () => {
    await coverage.claim(tiles, 'owner-a', 180);
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 1_000);
    await coverage.markFailed(
      tiles.map((tile, i) => ({ tile, retryAfter: i < 2 ? future : past })),
      'owner-a',
      'timeout',
    );
    const failed = await coverage.get(tiles);
    expect(failed.every((c) => c.state === 'failed' && c.errorClass === 'timeout' && c.leaseOwner === undefined)).toBe(true);
    expect(await coverage.claim(tiles, 'owner-b', 180)).toEqual(tiles.slice(2));
  });

  it('ignores writes from an owner that lost its lease', async () => {
    await coverage.claim(tiles, 'stale', -1);
    await coverage.claim(tiles, 'fresh', 180);
    await coverage.markFailed(tiles.map((tile) => ({ tile, retryAfter: new Date() })), 'stale', 'network');
    const completed = await new PgFeatureStore(pool).storeAndComplete({ release: 'r', features: [] }, tiles, 'stale', 'req');
    expect(completed).toEqual([]);
    expect((await coverage.get(tiles)).every((c) => c.state === 'fetching' && c.leaseOwner === 'fresh')).toBe(true);
  });

  it('hands every lease of an owner back for immediate retry', async () => {
    await coverage.claim(tiles, 'stopping', 180);
    expect(await coverage.releaseOwner('stopping')).toBe(tiles.length);
    expect((await coverage.get(tiles)).every((c) => c.state === 'failed' && c.errorClass === 'interrupted')).toBe(true);
    expect(await coverage.claim(tiles, 'next', 180)).toEqual(tiles);
  });
});

describe('PgFeatureStore and PgFeatureReader', () => {
  const owner = 'store-test';
  let coverage: PgTileCoverageRepository;
  let store: PgFeatureStore;
  let reader: PgFeatureReader;
  const source = () => new OvertureMapDataSource(duck, { baseUrl: OVERTURE_FIXTURE, release: FIXTURE_RELEASE });

  beforeEach(async () => {
    await truncate();
    coverage = new PgTileCoverageRepository(pool);
    store = new PgFeatureStore(pool);
    reader = new PgFeatureReader(pool);
  });

  async function storeTiles(tiles: TileKey[], batch?: FeatureBatch): Promise<TileKey[]> {
    await coverage.claim(tiles, owner, 180);
    const fetched = batch ?? (await source().fetch(boundsOfTiles(tiles), { timeoutMs: 60_000 }));
    return store.storeAndComplete(fetched, tiles, owner, 'req-store');
  }

  async function count(): Promise<number> {
    const result = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM map_feature');
    return result.rows[0]?.n ?? 0;
  }

  it('stores a fetched area and completes its tiles with provenance', async () => {
    const tiles = tilesCovering(POC, 250);
    const completed = await storeTiles(tiles);
    expect(completed).toEqual(tiles);
    const stored = await coverage.get(tiles);
    expect(stored.every((c) => c.state === 'complete' && c.release === FIXTURE_RELEASE && c.fetchRequestId === 'req-store')).toBe(true);
    expect(stored.every((c) => (c.featureCount ?? 0) > 0)).toBe(true);
    const invalid = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM map_feature WHERE NOT ST_IsValid(geom)');
    expect(invalid.rows[0]?.n).toBe(0);
  });

  it('is idempotent when the same batch is stored again', async () => {
    const tiles = tilesCovering(POC, 250);
    const batch = await source().fetch(boundsOfTiles(tiles), { timeoutMs: 60_000 });
    await storeTiles(tiles, batch);
    const first = await count();
    await pool.query("UPDATE tile_coverage SET state = 'missing'");
    await storeTiles(tiles, batch);
    expect(await count()).toBe(first);
  });

  it('stores a feature that crosses a tile edge once', async () => {
    const centre = tileOf(POC);
    const east = { x: centre.x + 1, y: centre.y };
    const left = await source().fetch(boundsOf(centre), { timeoutMs: 60_000 });
    const right = await source().fetch(boundsOf(east), { timeoutMs: 60_000 });
    const shared = left.features.filter((f) => right.features.some((g) => g.id === f.id));
    expect(shared.length).toBeGreaterThan(0);
    await storeTiles([centre], left);
    await storeTiles([east], right);
    expect(await count()).toBe(new Set([...left.features, ...right.features].map((f) => f.id)).size);
  });

  it('applies the radius exactly', async () => {
    const wkb = async (x: number, y: number): Promise<Uint8Array> => {
      const [lon, lat] = fromLocal(POC, { x, y });
      const result = await pool.query<{ b: Buffer }>('SELECT ST_AsBinary(ST_MakePoint($1, $2)) AS b', [lon, lat]);
      return new Uint8Array(result.rows[0]!.b);
    };
    const tree = async (id: string, x: number, y: number): Promise<IngestFeature> => ({
      id,
      layer: 'tree',
      kind: 'tree',
      geometryWkb: await wkb(x, y),
      sourceDataset: 'OpenStreetMap',
      attrs: {},
    });
    const tiles = [tileOf(POC)];
    await storeTiles(tiles, {
      release: 'test',
      features: [await tree('inside', 0, 95), await tree('outside', 0, 105), await tree('diagonal', 70, 70)],
    });
    const within = await reader.readWithin(POC, 100);
    expect(within.trees.map((t) => t.id).sort((p, q) => p.localeCompare(q))).toEqual(['diagonal', 'inside']);
  });

  it('repairs invalid geometry before storing it', async () => {
    const bowtie = await pool.query<{ b: Buffer }>(
      "SELECT ST_AsBinary(ST_GeomFromText('POLYGON((-46.7470 -23.5486, -46.7468 -23.5484, -46.7468 -23.5486, -46.7470 -23.5484, -46.7470 -23.5486))')) AS b",
    );
    const feature: IngestFeature = {
      id: 'bowtie',
      layer: 'building',
      kind: 'building',
      geometryWkb: new Uint8Array(bowtie.rows[0]!.b),
      sourceDataset: 'OpenStreetMap',
      attrs: {},
    };
    await storeTiles([tileOf(POC)], { release: 'test', features: [feature] });
    const stored = await pool.query<{ valid: boolean; type: string }>(
      "SELECT ST_IsValid(geom) AS valid, GeometryType(geom) AS type FROM map_feature WHERE id = 'bowtie'",
    );
    expect(stored.rows).toEqual([{ valid: true, type: 'MULTIPOLYGON' }]);
    const scene = await reader.readWithin(POC, 200);
    expect(scene.buildings.find((b) => b.id === 'bowtie')?.footprint).toHaveLength(2);
  });

  it('decodes every layer with its attribution datasets', async () => {
    await storeTiles(tilesCovering(POC, 250));
    const features = await reader.readWithin(POC, 250);
    expect(features.buildings.length).toBeGreaterThan(100);
    expect(features.lines.length).toBeGreaterThan(10);
    expect(features.lines.some((l) => l.name === 'Avenida Bolonha')).toBe(true);
    expect(features.datasets).toContain('OpenStreetMap');
    expect([...features.datasets].sort((a, b) => a.localeCompare(b))).toEqual(features.datasets);
  });
});
