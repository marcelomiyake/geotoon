// Records the Overture test fixture: the PoC tile and its 8 neighbours, with only the
// columns the adapter reads. Run once with network access and commit the output:
//
//   npm run build && node apps/api/scripts/record-overture-fixture.ts
//
// Not shipped in the image. Output: fixtures/overture/<release>/theme=…/type=…/part-0.parquet
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { boundsOfTiles, tileOf, type TileKey } from '@geotoon/core';

const RELEASE = '2026-10-21.0';
const SOURCE = 's3://overturemaps-us-west-2/release';
const POC = { lat: -23.548_581_7, lon: -46.746_914_4 };
const LAND_SUBTYPES = "('tree', 'forest', 'grass', 'shrub')";

const COMMON =
  'id, geometry, bbox, subtype, class, ' +
  "list_transform(sources, lambda s: {'dataset': s.dataset, 'record_id': s.record_id}) AS sources";

const LAYERS = [
  { theme: 'buildings', type: 'building', columns: `${COMMON}, height, num_floors, min_height`, where: '' },
  { theme: 'transportation', type: 'segment', columns: `${COMMON}, {'primary': names.primary} AS names`, where: '' },
  { theme: 'base', type: 'land_use', columns: COMMON, where: '' },
  { theme: 'base', type: 'water', columns: COMMON, where: '' },
  { theme: 'base', type: 'land', columns: COMMON, where: ` AND subtype IN ${LAND_SUBTYPES}` },
] as const;

function quoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

const centre = tileOf(POC);
const tiles: TileKey[] = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    tiles.push({ x: centre.x + dx, y: centre.y + dy });
  }
}
const b = boundsOfTiles(tiles);
const bbox = `bbox.xmin < ${b.east} AND bbox.xmax > ${b.west} AND bbox.ymin < ${b.north} AND bbox.ymax > ${b.south}`;

const outputRoot = path.resolve('fixtures/overture', RELEASE);
const extensionDir = process.env['DUCKDB_EXTENSION_DIR'] ?? path.resolve('node_modules/.cache/geotoon-duckdb');
const instance = await DuckDBInstance.create(':memory:', { extension_directory: extensionDir });
const connection = await instance.connect();
await connection.run('INSTALL httpfs');
await connection.run('LOAD httpfs');
await connection.run("SET s3_region = 'us-west-2'");

await rm(outputRoot, { recursive: true, force: true });
for (const layer of LAYERS) {
  const directory = path.join(outputRoot, `theme=${layer.theme}`, `type=${layer.type}`);
  await mkdir(directory, { recursive: true });
  const input = `${SOURCE}/${RELEASE}/theme=${layer.theme}/type=${layer.type}/*`;
  const output = path.join(directory, 'part-0.parquet');
  const started = Date.now();
  await connection.run(
    `COPY (SELECT ${layer.columns} FROM read_parquet(${quoted(input)}, hive_partitioning = 1) ` +
      `WHERE ${bbox}${layer.where} ORDER BY id) TO ${quoted(output)} (FORMAT parquet, COMPRESSION zstd)`,
  );
  const count = await connection.runAndReadAll(
    `SELECT count(*)::INTEGER AS n FROM read_parquet(${quoted(output)})`,
  );
  const rows = Number(count.getRowObjectsJS()[0]?.['n'] ?? 0);
  console.log(`${layer.theme}/${layer.type}: ${rows} rows in ${Date.now() - started} ms`);
}
connection.closeSync();
instance.closeSync();
