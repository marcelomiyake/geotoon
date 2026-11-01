import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { Logger } from '@geotoon/core';
import { inSequence } from '../in-sequence.js';

const MIGRATION_FILE = /^(\d{4})_[\w-]+\.sql$/;
const LOCK_KEY = 'geotoon-migrations';

export interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly fullPath: string;
}

export interface MigrationResult {
  readonly applied: number[];
  /** Highest version present in the database after this run. */
  readonly databaseVersion: number;
  /** Highest version shipped with this build. */
  readonly codeVersion: number;
}

export async function listMigrations(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory);
  const files: MigrationFile[] = [];
  for (const name of entries) {
    const match = MIGRATION_FILE.exec(name);
    if (match?.[1] !== undefined) {
      files.push({ version: Number(match[1]), name, fullPath: path.join(directory, name) });
    }
  }
  return files.sort((a, b) => a.version - b.version);
}

/**
 * Applies missing migrations in order, one transaction per file, under a session advisory
 * lock so concurrent starts cannot race. A database ahead of the code is allowed (rollback);
 * a database behind it after this run is an error.
 */
export async function migrate(
  pool: pg.Pool,
  directory: string,
  logger: Logger,
): Promise<MigrationResult> {
  const files = await listMigrations(directory);
  const codeVersion = files.at(-1)?.version ?? 0;
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(done.rows.map((row) => row.version));
    const pending = files.filter((file) => !appliedVersions.has(file.version));
    await inSequence(pending, async (file) => {
      await applyMigration(client, file);
      logger.info('migration applied', { version: file.version, name: file.name });
    });
    const applied = pending.map((file) => file.version);
    const latest = await client.query<{ version: number | null }>(
      'SELECT max(version) AS version FROM schema_migrations',
    );
    const databaseVersion = latest.rows[0]?.version ?? 0;
    checkVersions(databaseVersion, codeVersion, logger);
    return { applied, databaseVersion, codeVersion };
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/** Runs one migration file and records its version, in a single transaction. */
async function applyMigration(client: pg.PoolClient, file: MigrationFile): Promise<void> {
  const sql = await readFile(file.fullPath, 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file.version]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${file.name} failed`, { cause: error });
  }
}

function checkVersions(databaseVersion: number, codeVersion: number, logger: Logger): void {
  if (databaseVersion < codeVersion) {
    throw new Error(`Database schema ${databaseVersion} is behind code schema ${codeVersion}`);
  }
  if (databaseVersion > codeVersion) {
    logger.warn('database schema is newer than this build; running in rollback mode', {
      databaseVersion,
      codeVersion,
    });
  }
}
