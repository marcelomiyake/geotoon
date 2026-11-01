/** `[lon, lat]` in WGS84 degrees. */
export type Position = readonly [number, number];
export type LineCoords = readonly Position[];
/** Outer ring first, then holes. */
export type PolygonCoords = readonly LineCoords[];
export type MultiPolygonCoords = readonly PolygonCoords[];
export type MultiLineCoords = readonly LineCoords[];

export const FEATURE_LAYERS = ['building', 'line', 'area', 'tree'] as const;
export type FeatureLayer = (typeof FEATURE_LAYERS)[number];

export const LINE_KINDS = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'service',
  'unclassified',
  'footway',
  'path',
  'cycleway',
  'steps',
  'rail',
  'stream',
  'river',
  'other',
] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const AREA_KINDS = [
  'park',
  'grass',
  'pitch',
  'water',
  'forest',
  'residential',
  'industrial',
  'commercial',
  'education',
  'other',
] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

/** Rendered width of each line kind, in metres. */
export const LINE_WIDTH_M: Readonly<Record<LineKind, number>> = {
  motorway: 14,
  trunk: 12,
  primary: 10,
  secondary: 9,
  tertiary: 8,
  residential: 6,
  unclassified: 6,
  service: 4,
  footway: 2,
  path: 2,
  cycleway: 2,
  steps: 2,
  rail: 3,
  stream: 3,
  river: 8,
  other: 5,
};

/** Lines a pedestrian can stand on. */
export const WALKABLE_LINE_KINDS: ReadonlySet<LineKind> = new Set(
  LINE_KINDS.filter((kind) => kind !== 'rail' && kind !== 'stream' && kind !== 'river'),
);

export function isLineKind(value: string): value is LineKind {
  return (LINE_KINDS as readonly string[]).includes(value);
}

export function isAreaKind(value: string): value is AreaKind {
  return (AREA_KINDS as readonly string[]).includes(value);
}

/** A building as stored: raw height inputs are kept so the height rule can change. */
export interface StoredBuilding {
  readonly id: string;
  readonly footprint: MultiPolygonCoords;
  readonly sourceHeightM?: number;
  readonly numFloors?: number;
  readonly minHeightM?: number;
  readonly kind: string;
}

export interface MapLine {
  readonly id: string;
  readonly kind: LineKind;
  readonly name?: string;
  readonly coords: MultiLineCoords;
}

export interface MapArea {
  readonly id: string;
  readonly kind: AreaKind;
  readonly polygons: MultiPolygonCoords;
}

export type TreeGeometry =
  | { readonly type: 'point'; readonly position: Position }
  | { readonly type: 'line'; readonly coords: LineCoords };

export interface TreeFeature {
  readonly id: string;
  readonly geometry: TreeGeometry;
}

/**
 * A feature on its way from a source into storage. The geometry stays as WKB bytes:
 * the domain never decodes it, and the database repairs and indexes it.
 */
export interface IngestFeature {
  readonly id: string;
  readonly layer: FeatureLayer;
  readonly kind: string;
  readonly geometryWkb: Uint8Array;
  readonly heightM?: number | null;
  readonly numFloors?: number | null;
  readonly minHeightM?: number | null;
  readonly name?: string | null;
  readonly sourceDataset: string;
  readonly sourceRecordId?: string | null;
  readonly attrs: Readonly<Record<string, string>>;
}

export interface FeatureBatch {
  readonly release: string;
  readonly features: readonly IngestFeature[];
}
