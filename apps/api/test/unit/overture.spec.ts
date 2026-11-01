import {
  AREA_KINDS,
  LINE_KINDS,
  SourceError,
  boundsOfTiles,
  tilesCovering,
  type FeatureBatch,
} from '@geotoon/core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { QueryAbortedError, type DuckDbClient } from '../../src/adapters/overture/duckdb-client.js';
import { OvertureMapDataSource } from '../../src/adapters/overture/overture-map-data-source.js';
import {
  WkbType,
  landUseKind,
  mapBuilding,
  mapLand,
  mapLandUse,
  mapSegment,
  mapWater,
  segmentKind,
  wkbGeometryType,
  type BuildingRow,
  type OvertureRow,
} from '../../src/adapters/overture/overture-mapping.js';
import { FIXTURE_RELEASE, OVERTURE_FIXTURE, POC, openDuck } from '../support.js';

/** A WKB header (byte order + type) followed by padding; the mapping reads only the header. */
function wkb(type: number, littleEndian = true): Uint8Array {
  const bytes = new Uint8Array(9);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, littleEndian ? 1 : 0);
  view.setUint32(1, type, littleEndian);
  return bytes;
}

function row(type: number, fields: Partial<OvertureRow> = {}): OvertureRow {
  return { id: 'id-1', geometry: wkb(type), subtype: null, class: null, dataset: null, recordId: null, ...fields };
}

describe('wkbGeometryType', () => {
  it('reads both byte orders and strips Z/M offsets and EWKB flags', () => {
    expect(wkbGeometryType(wkb(WkbType.Polygon))).toBe(3);
    expect(wkbGeometryType(wkb(WkbType.LineString, false))).toBe(2);
    expect(wkbGeometryType(wkb(1006))).toBe(6);
    expect(wkbGeometryType(wkb(0x20_00_00_03))).toBe(3);
    expect(wkbGeometryType(new Uint8Array(3))).toBe(0);
  });
});

describe('Overture mapping', () => {
  const building = (fields: Partial<BuildingRow>): BuildingRow => ({
    ...row(WkbType.Polygon),
    height: null,
    numFloors: null,
    minHeight: null,
    ...fields,
  });

  it('keeps sane building heights and drops impossible ones', () => {
    expect(mapBuilding(building({ height: 12.5, numFloors: 3.6, minHeight: 2, class: 'house' }))).toMatchObject({
      layer: 'building',
      kind: 'house',
      heightM: 12.5,
      numFloors: 4,
      minHeightM: 2,
      sourceDataset: 'OpenStreetMap',
      attrs: { class: 'house' },
    });
    expect(mapBuilding(building({ height: 5000, numFloors: -1, minHeight: -3 }))).toMatchObject({
      kind: 'unknown',
      heightM: null,
      numFloors: null,
      minHeightM: null,
    });
    expect(mapBuilding(building({ minHeight: 2000, subtype: 'commercial', dataset: 'Google Open Buildings' }))).toMatchObject({
      kind: 'commercial',
      minHeightM: 1000,
      sourceDataset: 'Google Open Buildings',
    });
    expect(mapBuilding({ ...building({}), geometry: wkb(WkbType.Point) })).toBeUndefined();
  });

  it('classifies road and rail segments', () => {
    expect(segmentKind('road', 'living_street')).toBe('residential');
    expect(segmentKind('road', 'sidewalk')).toBe('footway');
    expect(segmentKind('road', 'raceway')).toBe('other');
    expect(segmentKind('road', null)).toBe('other');
    expect(segmentKind('rail', 'subway')).toBe('rail');
    expect(segmentKind('water', null)).toBeUndefined();
    expect(mapSegment({ ...row(WkbType.LineString, { subtype: 'road', class: 'primary' }), name: 'Av. Jaguaré' })).toMatchObject({
      layer: 'line',
      kind: 'primary',
      name: 'Av. Jaguaré',
    });
    expect(mapSegment({ ...row(WkbType.Polygon, { subtype: 'road' }), name: null })).toBeUndefined();
  });

  it('maps land use to area kinds', () => {
    expect(landUseKind('park', null)).toBe('park');
    expect(landUseKind('recreation', 'pitch')).toBe('pitch');
    expect(landUseKind('cemetery', null)).toBe('grass');
    expect(landUseKind('residential', null)).toBe('residential');
    expect(landUseKind('education', 'school')).toBe('education');
    expect(landUseKind('developed', 'industrial')).toBe('industrial');
    expect(landUseKind('developed', 'retail')).toBe('commercial');
    expect(landUseKind('developed', 'parking')).toBe('other');
    expect(landUseKind('transportation', 'pitch')).toBe('pitch');
    expect(landUseKind(null, null)).toBe('other');
    expect(mapLandUse(row(WkbType.MultiPolygon, { subtype: 'park' }))).toMatchObject({ layer: 'area', kind: 'park' });
    expect(mapLandUse(row(WkbType.LineString))).toBeUndefined();
  });

  it('maps water polygons, rivers and streams', () => {
    expect(mapWater(row(WkbType.Polygon))).toMatchObject({ layer: 'area', kind: 'water' });
    expect(mapWater(row(WkbType.LineString, { subtype: 'river' }))).toMatchObject({ layer: 'line', kind: 'river' });
    expect(mapWater(row(WkbType.MultiLineString, { subtype: 'stream' }))).toMatchObject({ layer: 'line', kind: 'stream' });
    expect(mapWater(row(WkbType.Point))).toBeUndefined();
  });

  it('maps trees, tree rows, forests and grass', () => {
    expect(mapLand(row(WkbType.Point, { subtype: 'tree' }))).toMatchObject({ layer: 'tree', kind: 'tree' });
    expect(mapLand(row(WkbType.LineString, { class: 'tree_row' }))).toMatchObject({ layer: 'tree', kind: 'tree_row' });
    expect(mapLand(row(WkbType.Point, { subtype: 'grass' }))).toBeUndefined();
    expect(mapLand(row(WkbType.Polygon, { class: 'wood' }))).toMatchObject({ layer: 'area', kind: 'forest' });
    expect(mapLand(row(WkbType.Polygon, { subtype: 'shrub' }))).toMatchObject({ layer: 'area', kind: 'grass' });
    expect(mapLand(row(WkbType.MultiPoint))).toBeUndefined();
  });
});

describe('OvertureMapDataSource on the recorded fixture', () => {
  let duck: DuckDbClient;
  const bounds = boundsOfTiles(tilesCovering(POC, 250));
  const source = (release = FIXTURE_RELEASE) => new OvertureMapDataSource(duck, { baseUrl: OVERTURE_FIXTURE, release });

  beforeAll(async () => {
    duck = await openDuck(inject('duckdbExtensionDir'));
  });

  afterAll(() => {
    duck.close();
  });

  it('loads httpfs and reports ready', async () => {
    expect(await duck.isReady()).toBe(true);
  });

  it('reads every layer of the area in one call', async () => {
    const batch: FeatureBatch = await source().fetch(bounds, { timeoutMs: 60_000 });
    const byLayer = Object.groupBy(batch.features, (f) => f.layer);

    expect(batch.release).toBe(FIXTURE_RELEASE);
    expect(byLayer.building?.length).toBeGreaterThan(500);
    expect(byLayer.line?.length).toBeGreaterThan(20);
    expect(byLayer.area?.length).toBeGreaterThan(0);
    for (const line of byLayer.line ?? []) {
      expect(LINE_KINDS).toContain(line.kind);
    }
    for (const area of byLayer.area ?? []) {
      expect(AREA_KINDS).toContain(area.kind);
    }
    expect(batch.features.every((f) => f.geometryWkb.length > 9 && f.id !== '')).toBe(true);
    expect(new Set(batch.features.map((f) => f.id)).size).toBe(batch.features.length);
    expect(byLayer.line?.some((l) => l.name === 'Avenida Bolonha')).toBe(true);
  });

  it('builds the S3 path layout from the base URL and release', () => {
    expect(new OvertureMapDataSource(duck, { baseUrl: 's3://bucket/release', release: 'r1' }).pathFor('base', 'water')).toBe(
      's3://bucket/release/r1/theme=base/type=water/*',
    );
  });

  it('reports a missing release as release_not_found', async () => {
    const error = await source('2000-01-01.0').fetch(bounds, { timeoutMs: 60_000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ errorClass: 'release_not_found' });
  });

  it('reports timeout when the deadline interrupts the queries', async () => {
    // A client whose queries end only when interrupted, so the deadline always wins.
    const hanging = {
      query: (_sql: string, _params: unknown[], signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new QueryAbortedError()), { once: true });
        }),
    } as unknown as DuckDbClient;
    const slow = new OvertureMapDataSource(hanging, { baseUrl: OVERTURE_FIXTURE, release: FIXTURE_RELEASE });
    const error = await slow.fetch(bounds, { timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ errorClass: 'timeout' });
  });

  it('interrupts a running DuckDB query when its signal aborts', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('timeout')), 50);
    const started = Date.now();
    const error = await duck
      .query('SELECT count(*) FROM range(1000000000000)', [], controller.signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueryAbortedError);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('does not start a query whose signal already aborted', async () => {
    await expect(duck.query('SELECT 1', [], AbortSignal.abort())).rejects.toBeInstanceOf(QueryAbortedError);
  });

  it('runs again after an interrupted call', async () => {
    const batch = await source().fetch(bounds, { timeoutMs: 60_000 });
    expect(batch.features.length).toBeGreaterThan(0);
  });
});
