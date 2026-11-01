import pg from 'pg';

export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

export function createPool(config: DatabaseConfig): pg.Pool {
  return new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 60_000,
    application_name: 'geotoon-api',
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Retries `SELECT 1` until the database answers or `timeoutMs` passes. */
export async function waitForDatabase(pool: pg.Pool, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error('Database did not become reachable in time', { cause: error });
      }
      await sleep(1_000);
    }
  }
}
