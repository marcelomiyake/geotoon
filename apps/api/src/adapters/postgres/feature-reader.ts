import type pg from 'pg';
import {
  EARTH_RADIUS_M,
  isAreaKind,
  isLineKind,
  type FeatureReader,
  type GeoPoint,
  type LineCoords,
  type MapArea,
  type MapLine,
  type MultiLineCoords,
  type MultiPolygonCoords,
  type Position,
  type StoredBuilding,
  type StoredFeatures,
  type TreeFeature,
} from '@geotoon/core';

type GeoJsonGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: LineCoords }
  | { type: 'MultiLineString'; coordinates: MultiLineCoords }
  | { type: 'Polygon'; coordinates: MultiPolygonCoords[number] }
  | { type: 'MultiPolygon'; coordinates: MultiPolygonCoords };

interface FeatureRow {
  id: string;
  layer: string;
  kind: string;
  geometry: GeoJsonGeometry;
  height_m: number | null;
  num_floors: number | null;
  min_height_m: number | null;
  name: string | null;
  source_dataset: string;
}

// The envelope test uses the GiST index; ST_DWithin on geography then applies the exact radius.
const READ_WITHIN = `
  SELECT id, layer, kind, ST_AsGeoJSON(geom, 6)::json AS geometry,
         height_m, num_floors, min_height_m, name, source_dataset
  FROM map_feature
  WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
    AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7)`;

/** Reads stored features within a radius and decodes them into domain types. */
export class PgFeatureReader implements FeatureReader {
  constructor(private readonly pool: pg.Pool) {}

  async readWithin(centre: GeoPoint, radiusM: number): Promise<StoredFeatures> {
    const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
    const dLon = dLat / Math.cos((centre.lat * Math.PI) / 180);
    const result = await this.pool.query<FeatureRow>(READ_WITHIN, [
      centre.lon - dLon,
      centre.lat - dLat,
      centre.lon + dLon,
      centre.lat + dLat,
      centre.lon,
      centre.lat,
      radiusM,
    ]);
    return toStoredFeatures(result.rows);
  }
}

export function toStoredFeatures(rows: readonly FeatureRow[]): StoredFeatures {
  const buildings: StoredBuilding[] = [];
  const lines: MapLine[] = [];
  const areas: MapArea[] = [];
  const trees: TreeFeature[] = [];
  const datasets = new Set<string>();
  for (const row of rows) {
    datasets.add(row.source_dataset);
    switch (row.layer) {
      case 'building':
        buildings.push({
          id: row.id,
          kind: row.kind,
          footprint: polygons(row.geometry),
          sourceHeightM: row.height_m ?? undefined,
          numFloors: row.num_floors ?? undefined,
          minHeightM: row.min_height_m ?? undefined,
        });
        break;
      case 'line':
        lines.push({
          id: row.id,
          kind: isLineKind(row.kind) ? row.kind : 'other',
          name: row.name ?? undefined,
          coords: linework(row.geometry),
        });
        break;
      case 'area':
        areas.push({
          id: row.id,
          kind: isAreaKind(row.kind) ? row.kind : 'other',
          polygons: polygons(row.geometry),
        });
        break;
      default:
        trees.push(...treeOf(row));
    }
  }
  return { buildings, lines, areas, trees, datasets: [...datasets].sort() };
}

function polygons(geometry: GeoJsonGeometry): MultiPolygonCoords {
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates];
  }
  return geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
}

function linework(geometry: GeoJsonGeometry): MultiLineCoords {
  if (geometry.type === 'LineString') {
    return [geometry.coordinates];
  }
  return geometry.type === 'MultiLineString' ? geometry.coordinates : [];
}

function treeOf(row: FeatureRow): TreeFeature[] {
  if (row.geometry.type === 'Point') {
    return [{ id: row.id, geometry: { type: 'point', position: row.geometry.coordinates } }];
  }
  if (row.geometry.type === 'LineString') {
    return [{ id: row.id, geometry: { type: 'line', coords: row.geometry.coordinates } }];
  }
  return [];
}
