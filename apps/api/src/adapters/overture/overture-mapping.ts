import type { AreaKind, FeatureLayer, IngestFeature, LineKind } from '@geotoon/core';

/** WKB geometry type codes (2D, ISO). */
export const WkbType = {
  Point: 1,
  LineString: 2,
  Polygon: 3,
  MultiPoint: 4,
  MultiLineString: 5,
  MultiPolygon: 6,
} as const;

const POLYGONAL: ReadonlySet<number> = new Set([WkbType.Polygon, WkbType.MultiPolygon]);
const LINEAR: ReadonlySet<number> = new Set([WkbType.LineString, WkbType.MultiLineString]);

/**
 * Reads the base geometry type from a WKB header (byte order + uint32 type). ISO Z/M
 * offsets (1000, 2000, 3000) and EWKB flag bits are stripped. Returns 0 for short input.
 */
export function wkbGeometryType(wkb: Uint8Array): number {
  if (wkb.length < 5) {
    return 0;
  }
  const view = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
  const littleEndian = view.getUint8(0) === 1;
  const raw = view.getUint32(1, littleEndian) & 0x0fffffff;
  return raw % 1000;
}

/** Raw columns shared by every Overture query. */
export interface OvertureRow {
  readonly id: string;
  readonly geometry: Uint8Array;
  readonly subtype: string | null;
  readonly class: string | null;
  readonly dataset: string | null;
  readonly recordId: string | null;
}

export interface BuildingRow extends OvertureRow {
  readonly height: number | null;
  readonly numFloors: number | null;
  readonly minHeight: number | null;
}

export interface SegmentRow extends OvertureRow {
  readonly name: string | null;
}

const ROAD_CLASSES: Readonly<Record<string, LineKind>> = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  residential: 'residential',
  living_street: 'residential',
  unclassified: 'unclassified',
  service: 'service',
  pedestrian: 'footway',
  footway: 'footway',
  sidewalk: 'footway',
  crosswalk: 'footway',
  steps: 'steps',
  path: 'path',
  track: 'path',
  bridleway: 'path',
  cycleway: 'cycleway',
};

const MAX_HEIGHT_M = 1000;
const MAX_FLOORS = 200;
const DEFAULT_DATASET = 'OpenStreetMap';

function base(
  row: OvertureRow,
  layer: FeatureLayer,
  kind: string,
): Omit<IngestFeature, 'heightM' | 'numFloors' | 'minHeightM' | 'name'> {
  const attrs: Record<string, string> = {};
  if (row.subtype !== null) {
    attrs['subtype'] = row.subtype;
  }
  if (row.class !== null) {
    attrs['class'] = row.class;
  }
  return {
    id: row.id,
    layer,
    kind,
    geometryWkb: row.geometry,
    sourceDataset: row.dataset ?? DEFAULT_DATASET,
    sourceRecordId: row.recordId,
    attrs,
  };
}

function hasType(row: OvertureRow, allowed: ReadonlySet<number>): boolean {
  return allowed.has(wkbGeometryType(row.geometry));
}

function inRange(value: number | null, max: number): number | null {
  return value !== null && Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

export function mapBuilding(row: BuildingRow): IngestFeature | undefined {
  if (!hasType(row, POLYGONAL)) {
    return undefined;
  }
  const floors = inRange(row.numFloors, MAX_FLOORS);
  const minHeight =
    row.minHeight !== null && Number.isFinite(row.minHeight) && row.minHeight >= 0
      ? Math.min(row.minHeight, MAX_HEIGHT_M)
      : null;
  return {
    ...base(row, 'building', row.class ?? row.subtype ?? 'unknown'),
    heightM: inRange(row.height, MAX_HEIGHT_M),
    numFloors: floors === null ? null : Math.round(floors),
    minHeightM: minHeight,
  };
}

export function segmentKind(subtype: string | null, roadClass: string | null): LineKind | undefined {
  if (subtype === 'rail') {
    return 'rail';
  }
  if (subtype !== 'road') {
    return undefined;
  }
  return (roadClass === null ? undefined : ROAD_CLASSES[roadClass]) ?? 'other';
}

export function mapSegment(row: SegmentRow): IngestFeature | undefined {
  const kind = segmentKind(row.subtype, row.class);
  if (kind === undefined || !hasType(row, LINEAR)) {
    return undefined;
  }
  return { ...base(row, 'line', kind), name: row.name };
}

export function landUseKind(subtype: string | null, landClass: string | null): AreaKind {
  switch (subtype) {
    case 'park':
    case 'recreation':
    case 'protected':
      return landClass === 'pitch' ? 'pitch' : 'park';
    case 'managed':
    case 'horticulture':
    case 'agriculture':
    case 'cemetery':
      return 'grass';
    case 'residential':
      return 'residential';
    case 'education':
      return 'education';
    case 'developed':
      return developedKind(landClass);
    default:
      return landClass === 'pitch' ? 'pitch' : 'other';
  }
}

function developedKind(landClass: string | null): AreaKind {
  if (landClass === 'industrial') {
    return 'industrial';
  }
  if (landClass === 'commercial' || landClass === 'retail') {
    return 'commercial';
  }
  return 'other';
}

export function mapLandUse(row: OvertureRow): IngestFeature | undefined {
  if (!hasType(row, POLYGONAL)) {
    return undefined;
  }
  return base(row, 'area', landUseKind(row.subtype, row.class));
}

export function mapWater(row: OvertureRow): IngestFeature | undefined {
  const type = wkbGeometryType(row.geometry);
  if (POLYGONAL.has(type)) {
    return base(row, 'area', 'water');
  }
  if (LINEAR.has(type)) {
    const river = row.subtype === 'river' || row.subtype === 'canal' || row.class === 'river';
    return base(row, 'line', river ? 'river' : 'stream');
  }
  return undefined;
}

/** Land subtypes the query asks for; everything else in `base/land` is not drawn. */
export const LAND_SUBTYPES = ['tree', 'forest', 'grass', 'shrub'] as const;

export function mapLand(row: OvertureRow): IngestFeature | undefined {
  const type = wkbGeometryType(row.geometry);
  if (type === WkbType.Point || type === WkbType.LineString) {
    return row.subtype === 'tree' || row.class === 'tree' || row.class === 'tree_row'
      ? base(row, 'tree', row.class ?? 'tree')
      : undefined;
  }
  if (!POLYGONAL.has(type)) {
    return undefined;
  }
  const forest = row.subtype === 'forest' || row.subtype === 'tree' || row.class === 'wood';
  return base(row, 'area', forest ? 'forest' : 'grass');
}
