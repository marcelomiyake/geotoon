import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

const REQUIRED = { DATABASE_PASSWORD: 'test-only' };

describe('loadConfig', () => {
  it('fills safe defaults around the one required value', () => {
    const config = loadConfig(REQUIRED);
    expect(config).toMatchObject({
      port: 8080,
      staticDir: 'apps/web/dist',
      migrationsDir: undefined,
      database: { host: 'localhost', port: 5432, database: 'geotoon', user: 'geotoon', password: 'test-only' },
      overture: { baseUrl: 's3://overturemaps-us-west-2/release', release: '2026-10-21.0', timeoutMs: 120_000 },
      areaRadiusM: 2000,
      photon: { url: 'https://photon.komoot.io', timeoutMs: 4000 },
      rateLimits: { areasPerMinute: 30, geocodePerMinute: 60 },
      logLevel: 'info',
      gitSha: 'unknown',
    });
    expect(config.userAgent).toContain('github.com/marcelomiyake/geotoon');
    expect(config.duckdb.tempDirectory).toBe(path.join(tmpdir(), 'geotoon-duckdb'));
    expect(config.duckdb.extensionDirectory).toBeUndefined();
  });

  it('reads overrides, trims trailing slashes and treats empty paths as unset', () => {
    const config = loadConfig({
      ...REQUIRED,
      PORT: '9090',
      OVERTURE_BASE_URL: '/data/overture///',
      PHOTON_URL: 'https://photon.internal.example:2322/',
      OVERTURE_QUERY_TIMEOUT_S: '60',
      AREA_RADIUS_M: '1500',
      DUCKDB_EXTENSION_DIR: '',
      MIGRATIONS_DIR: '/app/migrations',
    });
    expect(config.port).toBe(9090);
    expect(config.overture.baseUrl).toBe('/data/overture');
    expect(config.overture.timeoutMs).toBe(60_000);
    expect(config.photon.url).toBe('https://photon.internal.example:2322');
    expect(config.areaRadiusM).toBe(1500);
    expect(config.duckdb.extensionDirectory).toBeUndefined();
    expect(config.migrationsDir).toBe('/app/migrations');
  });

  it('reports every invalid variable together', () => {
    const error = (() => {
      try {
        loadConfig({
          PORT: '0',
          OVERTURE_RELEASE: 'latest',
          OVERTURE_QUERY_TIMEOUT_S: '500',
          LOG_LEVEL: 'verbose',
        });
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(ConfigError);
    const problems = (error as ConfigError).problems.join('\n');
    for (const name of ['PORT', 'DATABASE_PASSWORD', 'OVERTURE_RELEASE', 'OVERTURE_QUERY_TIMEOUT_S', 'LOG_LEVEL']) {
      expect(problems).toContain(name);
    }
    expect((error as Error).message).toMatch(/^Invalid configuration:/);
  });

  it('rejects a radius above the maximum', () => {
    expect(() => loadConfig({ ...REQUIRED, AREA_RADIUS_M: '2500' })).toThrow(/AREA_RADIUS_M must not exceed/);
  });
});
