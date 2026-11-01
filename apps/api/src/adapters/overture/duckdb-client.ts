import { DuckDBInstance, type DuckDBValue, type JS } from '@duckdb/node-api';

export interface DuckDbConfig {
  readonly memoryLimit: string;
  readonly threads: number;
  readonly tempDirectory: string;
  /** Where `httpfs` is installed; the image bakes it in so startup needs no download. */
  readonly extensionDirectory?: string;
}

export type DuckRow = Record<string, JS>;

/** Thrown when a query is interrupted because its signal aborted. */
export class QueryAbortedError extends Error {
  constructor(cause?: unknown) {
    super('DuckDB query aborted', { cause });
    this.name = 'QueryAbortedError';
  }
}

/** One in-memory DuckDB instance with `httpfs` loaded, shared by every query. */
export class DuckDbClient {
  private constructor(private readonly instance: DuckDBInstance) {}

  static async open(config: DuckDbConfig): Promise<DuckDbClient> {
    const options: Record<string, string> = {
      memory_limit: config.memoryLimit,
      threads: String(config.threads),
      temp_directory: config.tempDirectory,
      autoinstall_known_extensions: 'false',
      autoload_known_extensions: 'false',
    };
    if (config.extensionDirectory !== undefined) {
      options['extension_directory'] = config.extensionDirectory;
    }
    const instance = await DuckDBInstance.create(':memory:', options);
    const connection = await instance.connect();
    try {
      await connection.run('LOAD httpfs');
      await connection.run("SET GLOBAL s3_region = 'us-west-2'");
    } finally {
      connection.closeSync();
    }
    return new DuckDbClient(instance);
  }

  /** Runs one statement on a fresh connection; aborting `signal` interrupts it. */
  async query(sql: string, params: readonly DuckDBValue[], signal?: AbortSignal): Promise<DuckRow[]> {
    if (isAborted(signal)) {
      throw new QueryAbortedError(signal?.reason);
    }
    const connection = await this.instance.connect();
    const onAbort = (): void => {
      connection.interrupt();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      // The abort event fires once; a signal that aborted while connecting would be missed.
      if (isAborted(signal)) {
        throw new QueryAbortedError(signal?.reason);
      }
      const reader = await connection.runAndReadAll(sql, [...params]);
      return reader.getRowObjectsJS();
    } catch (error) {
      if (isAborted(signal) && !(error instanceof QueryAbortedError)) {
        throw new QueryAbortedError(error);
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      connection.closeSync();
    }
  }

  /** Whether `httpfs` is loaded; used by the readiness probe. */
  async isReady(): Promise<boolean> {
    const rows = await this.query(
      "SELECT loaded FROM duckdb_extensions() WHERE extension_name = 'httpfs'",
      [],
    );
    return rows[0]?.['loaded'] === true;
  }

  close(): void {
    this.instance.closeSync();
  }
}

/** Reads the flag through a call so the compiler does not narrow it across awaits. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
