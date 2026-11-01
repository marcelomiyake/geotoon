import type { GeoPoint } from '../../shared/geo-point.js';
import type { Attribution } from './attribution.js';
import type { AreaKind, LineKind, MultiLineCoords, MultiPolygonCoords, Position } from './features.js';
import type { HeightSource } from './height-rule.js';
import type { Spawn } from './spawn-point.js';
import type { TerrainGrid } from './terrain.js';

export interface SceneBuilding {
  readonly id: string;
  readonly footprint: MultiPolygonCoords;
  readonly heightM: number;
  readonly minHeightM: number;
  readonly heightSource: HeightSource;
  readonly kind: string;
}

export interface SceneLine {
  readonly id: string;
  readonly kind: LineKind;
  readonly widthM: number;
  readonly name?: string;
  readonly coords: MultiLineCoords;
}

export interface SceneArea {
  readonly id: string;
  readonly kind: AreaKind;
  readonly polygons: MultiPolygonCoords;
}

/** Everything the browser needs to draw one area. */
export interface Scene {
  readonly centre: GeoPoint;
  readonly radiusM: number;
  readonly buildings: readonly SceneBuilding[];
  readonly lines: readonly SceneLine[];
  readonly areas: readonly SceneArea[];
  readonly trees: readonly Position[];
  readonly spawn: Spawn;
  readonly attribution: readonly Attribution[];
  readonly terrain?: TerrainGrid;
}
