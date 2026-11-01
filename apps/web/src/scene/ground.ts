import { type LocalPolygon, fillPolygon, normalisePolygon } from './extrude.js';
import { type MeshBuffer, type Vec2 } from './mesh-buffer.js';
import { GROUND_COLOUR, areaColour } from './palette.js';

/** Ground layers, drawn as separate meshes with their own polygon offset. */
export type GroundLayer = 'base' | 'landuse' | 'green' | 'water' | 'roads';

/** Height of each layer above the base, so flat layers do not flicker at eye height. */
export const LAYER_HEIGHT_M: Readonly<Record<GroundLayer, number>> = {
  base: 0,
  landuse: 0.01,
  water: 0.02,
  green: 0.03,
  roads: 0.05,
};

const GREEN_KINDS: ReadonlySet<string> = new Set(['park', 'grass', 'pitch', 'forest']);

export function layerForArea(kind: string): GroundLayer {
  if (kind === 'water') {
    return 'water';
  }
  return GREEN_KINDS.has(kind) ? 'green' : 'landuse';
}

/** Triangulates an area at the height of its layer. Returns triangles added. */
export function addArea(polygons: readonly LocalPolygon[], kind: string, out: MeshBuffer): number {
  const before = out.triangles;
  const y = LAYER_HEIGHT_M[layerForArea(kind)];
  const colour = areaColour(kind);
  for (const polygon of polygons) {
    const rings = normalisePolygon(polygon);
    if (rings.length > 0) {
      fillPolygon(rings, y, colour, out);
    }
  }
  return out.triangles - before;
}

/** A flat disc of `radius` metres around the origin, the ground under everything. */
export function addGroundDisc(radius: number, segments: number, out: MeshBuffer): number {
  const centre: Vec2 = [0, 0];
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    out.upTriangle(
      centre,
      [Math.cos(a0) * radius, Math.sin(a0) * radius],
      [Math.cos(a1) * radius, Math.sin(a1) * radius],
      LAYER_HEIGHT_M.base,
      GROUND_COLOUR,
    );
  }
  return segments;
}
