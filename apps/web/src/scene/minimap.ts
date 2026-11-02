import type { Scene } from '@geotoon/contracts';
import type { Point2 } from './collision.js';
import type { Vec2 } from './mesh-buffer.js';
import type { Projection } from './projection.js';

export const MINIMAP_VIEW_RADIUS_M = 200;
export const MINIMAP_TEXTURE_SIZE = 2048;
export const MINIMAP_SCALE_M = 100;

export type MinimapLayer = 'land' | 'green' | 'water' | 'road' | 'path' | 'rail' | 'building';
export interface MinimapPolygon {
  readonly layer: MinimapLayer;
  /** Outer ring followed by holes, projected in metres; north is negative z. */
  readonly rings: readonly (readonly Vec2[])[];
}
export interface MinimapLine {
  readonly layer: MinimapLayer;
  readonly points: readonly Vec2[];
  readonly widthM: number;
}
export interface MinimapData {
  readonly radiusM: number;
  readonly polygons: readonly MinimapPolygon[];
  readonly lines: readonly MinimapLine[];
}

/** Top-down geometry comes from the same scene and projection as the walking view. */
export function buildMinimap(scene: Scene, projection: Projection, radiusM: number): MinimapData {
  const project = (ring: readonly (readonly number[])[]): Vec2[] =>
    ring.map(([lon, lat]) => projection.toLocal(lon!, lat!));
  const polygons: MinimapPolygon[] = scene.areas.flatMap((area) => area.polygons.map((polygon) => ({
    layer: areaLayer(area.kind), rings: polygon.map(project),
  })));
  for (const building of scene.buildings) {
    for (const polygon of building.footprint) {
      polygons.push({ layer: 'building', rings: polygon.map(project) });
    }
  }
  const lines: MinimapLine[] = scene.lines.flatMap((line) => line.coords
    .filter((part) => part.length >= 2)
    .map((part) => ({ layer: lineLayer(line.kind), widthM: line.widthM, points: project(part) })));
  return { radiusM, polygons, lines };
}

function areaLayer(kind: string): MinimapLayer {
  if (kind === 'water') {
    return 'water';
  }
  return ['park', 'grass', 'forest', 'pitch'].includes(kind) ? 'green' : 'land';
}

function lineLayer(kind: string): MinimapLayer {
  if (kind === 'river' || kind === 'stream') {
    return 'water';
  }
  if (kind === 'rail') {
    return 'rail';
  }
  return ['footway', 'path', 'cycleway', 'steps'].includes(kind) ? 'path' : 'road';
}

/** A 400 m viewport follows the player on the fixed-resolution area image. */
export function minimapCrop(player: Point2, radiusM: number) {
  const pixelsPerM = MINIMAP_TEXTURE_SIZE / (radiusM * 2);
  return {
    x: (player.x - MINIMAP_VIEW_RADIUS_M + radiusM) * pixelsPerM,
    y: (player.z - MINIMAP_VIEW_RADIUS_M + radiusM) * pixelsPerM,
    size: MINIMAP_VIEW_RADIUS_M * 2 * pixelsPerM,
  };
}

export function minimapPoint(point: Point2, player: Point2, sizePx: number): Point2 {
  const pixelsPerM = sizePx / (MINIMAP_VIEW_RADIUS_M * 2);
  return { x: sizePx / 2 + (point.x - player.x) * pixelsPerM,
    z: sizePx / 2 + (point.z - player.z) * pixelsPerM };
}

/** Heading is clockwise from north, matching the walking camera; pitch has no effect. */
export function minimapHeading(yawRad: number): number {
  const turn = Math.PI * 2;
  return ((-yawRad % turn) + turn) % turn;
}
