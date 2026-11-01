import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Directory holding the DuckDB httpfs extension, shared by every API test. */
    duckdbExtensionDir: string;
  }
}

/**
 * Installs httpfs once into a cache folder (a no-op when it is already there), because
 * the API loads it at startup with automatic installs turned off.
 */
export default async function setup(project: TestProject): Promise<void> {
  const directory =
    process.env['DUCKDB_EXTENSION_DIR'] ?? path.resolve('node_modules/.cache/geotoon-duckdb');
  const instance = await DuckDBInstance.create(':memory:', { extension_directory: directory });
  const connection = await instance.connect();
  try {
    await connection.run('INSTALL httpfs');
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  project.provide('duckdbExtensionDir', directory);
}
