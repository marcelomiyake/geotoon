import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type pg from 'pg';
import type { Logger } from '@geotoon/core';
import { createPool, waitForDatabase, type DatabaseConfig } from '../../src/adapters/postgres/pool.js';

/** Same image and digest as the Helm chart, so tests run against what is deployed. */
export const POSTGIS_IMAGE =
  'postgis/postgis:17-3.6@sha256:1ac10b2551ba84ae05db8e7da477afcd0a3fede99bcb7705da2ee157390cb095';

export interface Postgis {
  readonly container: StartedPostgreSqlContainer;
  readonly config: DatabaseConfig;
  pool(database?: string): pg.Pool;
  stop(): Promise<void>;
}

/** Starts a throwaway PostGIS container; every pool it hands out is closed by `stop`. */
export async function startPostgis(): Promise<Postgis> {
  const container = await new PostgreSqlContainer(POSTGIS_IMAGE)
    .withDatabase('geotoon')
    .withUsername('geotoon')
    .withPassword('integration-test-only')
    .start();
  const config: DatabaseConfig = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
  };
  const pools: pg.Pool[] = [];
  const pool = (database = config.database): pg.Pool => {
    const created = createPool({ ...config, database });
    pools.push(created);
    return created;
  };
  // The image restarts PostgreSQL once after running its init scripts.
  await waitForDatabase(pool(), 60_000);
  return {
    container,
    config,
    pool,
    stop: async () => {
      await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
      await container.stop();
    },
  };
}

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
