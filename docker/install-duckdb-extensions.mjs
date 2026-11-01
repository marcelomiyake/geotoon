// Installs the DuckDB extensions the API loads at startup into a fixed directory, so the
// running container never downloads code. Usage: node install-duckdb-extensions.mjs <dir>
import { DuckDBInstance } from '@duckdb/node-api';

const directory = process.argv[2];
if (!directory) {
  throw new Error('usage: node install-duckdb-extensions.mjs <extension-directory>');
}
const instance = await DuckDBInstance.create(':memory:', { extension_directory: directory });
const connection = await instance.connect();
await connection.run('INSTALL httpfs');
await connection.run('LOAD httpfs');
const reader = await connection.runAndReadAll(
  "SELECT extension_version FROM duckdb_extensions() WHERE extension_name = 'httpfs'",
);
console.log('httpfs installed', reader.getRowObjectsJS()[0]);
connection.closeSync();
instance.closeSync();
