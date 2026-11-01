import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeoPoint } from '@geotoon/core';
import { DuckDbClient } from '../src/adapters/overture/duckdb-client.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = path.join(REPO_ROOT, 'fixtures');
export const OVERTURE_FIXTURE = path.join(FIXTURES, 'overture');
export const FIXTURE_RELEASE = '2026-10-21.0';

/** PoC address: Av. Bolonha, 200 - Jaguaré, São Paulo. */
export const POC: GeoPoint = { lat: -23.548_581_7, lon: -46.746_914_4 };

/** Opens DuckDB the way the API does, with httpfs from the test cache. */
export function openDuck(extensionDirectory: string): Promise<DuckDbClient> {
  return DuckDbClient.open({
    memoryLimit: '512MB',
    threads: 2,
    tempDirectory: mkdtempSync(path.join(tmpdir(), 'geotoon-test-duckdb-')),
    extensionDirectory,
  });
}
