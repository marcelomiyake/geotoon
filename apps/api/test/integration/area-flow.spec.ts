import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AreaResponseSchema, type AreaResponse } from '@geotoon/contracts';
import { CountingMapDataSource } from '@geotoon/core';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OvertureMapDataSource } from '../../src/adapters/overture/overture-map-data-source.js';
import { compose, type Application } from '../../src/composition-root.js';
import { loadConfig, type Config } from '../../src/config.js';
import { FIXTURES, FIXTURE_RELEASE, OVERTURE_FIXTURE, POC } from '../support.js';
import { startPostgis, type Postgis } from './postgis.js';

/** Small enough that every covering tile lies inside the recorded 3 x 3 fixture tiles. */
const RADIUS_M = 250;

let postgis: Postgis;
let config: Config;

beforeAll(async () => {
  postgis = await startPostgis();
  config = loadConfig({
    DATABASE_HOST: postgis.config.host,
    DATABASE_PORT: String(postgis.config.port),
    DATABASE_NAME: postgis.config.database,
    DATABASE_USER: postgis.config.user,
    DATABASE_PASSWORD: postgis.config.password,
    OVERTURE_BASE_URL: OVERTURE_FIXTURE,
    OVERTURE_RELEASE: FIXTURE_RELEASE,
    AREA_RADIUS_M: String(RADIUS_M),
    DUCKDB_EXTENSION_DIR: inject('duckdbExtensionDir'),
    STATIC_DIR: path.join(FIXTURES, 'no-web-client'),
    LOG_LEVEL: 'error',
  });
});

afterAll(async () => {
  await postgis?.stop();
});

/** Starts the real application with the Overture fixture behind a call counter. */
async function startApp(): Promise<{ app: Application; source: () => CountingMapDataSource }> {
  let counting: CountingMapDataSource | undefined;
  const app = await compose(config, pino({ level: 'silent' }), {
    terrain: { readWithin: () => Promise.resolve(undefined) },
    source: (duck) => {
      counting = new CountingMapDataSource(new OvertureMapDataSource(duck, config.overture));
      return counting;
    },
  });
  return { app, source: () => counting! };
}

async function requestArea(app: Application): Promise<{ status: number; body: AreaResponse }> {
  const response = await app.server.inject({
    method: 'POST',
    url: '/api/v1/areas',
    payload: { lat: POC.lat, lon: POC.lon },
  });
  return { status: response.statusCode, body: AreaResponseSchema.parse(response.json()) };
}

async function pollUntilReady(app: Application): Promise<{ status: number; body: AreaResponse }> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const answer = await requestArea(app);
    if (answer.body.status === 'ready' || Date.now() > deadline) {
      return answer;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('area request flow (design goal G2)', () => {
  it('fetches the source once, then serves repeat requests from PostGIS only', async () => {
    const { app, source } = await startApp();
    try {
      const first = await requestArea(app);
      expect(first.status).toBe(202);
      expect(first.body).toMatchObject({ status: 'pending', sourceCalls: 1 });

      const ready = await pollUntilReady(app);
      expect(ready.status).toBe(200);
      expect(ready.body.sourceCalls).toBe(0);
      expect(source().count()).toBe(1);

      const repeat = await requestArea(app);
      expect(repeat.status).toBe(200);
      expect(repeat.body.sourceCalls).toBe(0);
      expect(repeat.body.tiles.every((t) => t.state === 'complete' && t.release === FIXTURE_RELEASE)).toBe(true);
      expect(source().count()).toBe(1);

      if (repeat.body.status !== 'ready') {
        throw new Error('expected a ready area');
      }
      const { scene } = repeat.body;
      expect(scene.buildings.length).toBeGreaterThan(100);
      expect(scene.lines.some((line) => line.name === 'Avenida Bolonha')).toBe(true);
      expect(scene.attribution.map((a) => a.text)).toContain('Overture Maps Foundation');

      if (process.env['GEOTOON_RECORD_SCENE'] === '1') {
        // Refreshes the web client's scene fixture: GEOTOON_RECORD_SCENE=1 npm run test:integration
        mkdirSync(path.join(FIXTURES, 'scene'), { recursive: true });
        writeFileSync(path.join(FIXTURES, 'scene', 'poc-scene.json'), `${JSON.stringify(repeat.body)}\n`);
      }
    } finally {
      await app.close();
    }
  });

  it('still reads from PostGIS after a restart, with no source call', async () => {
    const { app, source } = await startApp();
    try {
      expect(app.storedTiles).toBeGreaterThan(0);
      const answer = await requestArea(app);
      expect(answer.status).toBe(200);
      expect(answer.body.sourceCalls).toBe(0);
      expect(source().count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('reports readiness of PostGIS, the schema and DuckDB', async () => {
    const { app } = await startApp();
    try {
      const response = await app.server.inject({ url: '/readyz' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ready: true,
        checks: { schema: 'ok: v2', duckdb: 'ok: httpfs loaded' },
      });
    } finally {
      await app.close();
    }
  });
});
