import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION } from '@geotoon/contracts';
import {
  IngestTiles,
  ReadScene,
  RequestArea,
  SuggestAddresses,
  TILE_ZOOM,
  type MapDataSource,
} from '@geotoon/core';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Logger as Pino } from 'pino';
import { InProcessScheduler } from './adapters/ingestion/in-process-scheduler.js';
import { DuckDbClient } from './adapters/overture/duckdb-client.js';
import { OvertureMapDataSource } from './adapters/overture/overture-map-data-source.js';
import { PhotonGeocoder } from './adapters/photon/photon-geocoder.js';
import { PgFeatureReader } from './adapters/postgres/feature-reader.js';
import { PgFeatureStore } from './adapters/postgres/feature-store.js';
import { migrate, type MigrationResult } from './adapters/postgres/migrator.js';
import { createPool, waitForDatabase } from './adapters/postgres/pool.js';
import { PgTileCoverageRepository } from './adapters/postgres/tile-coverage-repository.js';
import { PinoLogger } from './adapters/system/pino-logger.js';
import { systemClock } from './adapters/system/system-clock.js';
import { APP_VERSION, type Config } from './config.js';
import { buildServer } from './http/server.js';
import type { ReadinessReport } from './http/routes/ops.js';

const DATABASE_WAIT_MS = 60_000;

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export interface Application {
  readonly server: FastifyInstance;
  readonly owner: string;
  readonly migrations: MigrationResult;
  readonly storedTiles: number;
  /** Stops serving, hands back this process's leases and closes the pools. */
  close(): Promise<void>;
}

export interface ComposeOverrides {
  /** Replaces the Overture adapter (tests use a counting fixture source). */
  readonly source?: (duck: DuckDbClient) => MapDataSource;
}

/** Wires adapters, use cases and the HTTP server by hand. */
export async function compose(
  config: Config,
  pino: Pino,
  overrides: ComposeOverrides = {},
): Promise<Application> {
  const logger = new PinoLogger(pino);
  const pool = createPool(config.database);
  await waitForDatabase(pool, DATABASE_WAIT_MS);
  const migrations = await migrate(pool, config.migrationsDir ?? DEFAULT_MIGRATIONS_DIR, logger);
  const duck = await DuckDbClient.open(config.duckdb);

  const owner = `${hostname()}:${process.pid}:${randomUUID()}`;
  const coverage = new PgTileCoverageRepository(pool);
  const source = overrides.source?.(duck) ?? new OvertureMapDataSource(duck, config.overture);
  const ingest = new IngestTiles({
    source,
    coverage,
    store: new PgFeatureStore(pool),
    clock: systemClock,
    logger,
    timeoutMs: config.overture.timeoutMs,
  });
  const scheduler = new InProcessScheduler((job) => ingest.run(job), logger);
  const requestArea = new RequestArea({
    coverage,
    scheduler,
    readScene: new ReadScene(new PgFeatureReader(pool)),
    clock: systemClock,
    owner,
    radiusM: config.areaRadiusM,
  });
  const suggest = new SuggestAddresses(
    new PhotonGeocoder({ ...config.photon, userAgent: config.userAgent }),
    systemClock,
  );

  const server = await buildServer({
    logger: pino,
    staticDir: config.staticDir,
    requestArea,
    suggest,
    radiusM: config.areaRadiusM,
    rateLimits: config.rateLimits,
    readiness: () => readiness(pool, duck, migrations.codeVersion),
    version: {
      version: APP_VERSION,
      gitSha: config.gitSha,
      contractVersion: CONTRACT_VERSION,
      overtureRelease: config.overture.release,
      radiusM: config.areaRadiusM,
      tileZoom: TILE_ZOOM,
    },
  });

  const stored = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM tile_coverage WHERE state = 'complete'",
  );

  return {
    server,
    owner,
    migrations,
    storedTiles: stored.rows[0]?.n ?? 0,
    close: async () => {
      await server.close();
      const released = await coverage.releaseOwner(owner).catch(() => 0);
      logger.info('shutdown', { releasedTiles: released, queuedJobs: scheduler.pending });
      await pool.end();
      if (scheduler.pending === 0) {
        duck.close();
      }
    },
  };
}

async function readiness(
  pool: pg.Pool,
  duck: DuckDbClient,
  expectedSchema: number,
): Promise<ReadinessReport> {
  const checks: Record<string, string> = {};
  checks['postgis'] = await check(async () => {
    const result = await pool.query<{ v: string }>('SELECT postgis_version() AS v');
    return result.rows[0]?.v ?? 'unknown';
  });
  checks['schema'] = await check(async () => {
    const result = await pool.query<{ v: number | null }>(
      'SELECT max(version) AS v FROM schema_migrations',
    );
    const version = result.rows[0]?.v ?? 0;
    if (version < expectedSchema) {
      throw new Error(`schema ${version} < ${expectedSchema}`);
    }
    return `v${version}`;
  });
  checks['duckdb'] = await check(async () => {
    if (!(await duck.isReady())) {
      throw new Error('httpfs not loaded');
    }
    return 'httpfs loaded';
  });
  const ready = Object.values(checks).every((value) => !value.startsWith('fail'));
  return { ready, checks };
}

async function check(probe: () => Promise<string>): Promise<string> {
  try {
    return `ok: ${await probe()}`;
  } catch (error) {
    return `fail: ${error instanceof Error ? error.message : String(error)}`;
  }
}
