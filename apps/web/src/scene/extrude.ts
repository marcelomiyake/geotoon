import earcut from 'earcut';
import { type MeshBuffer, type Ring, type Vec2, openRing, orient } from './mesh-buffer.js';
import type { Rgb } from './palette.js';

/** A polygon in local metres: outer ring first, then holes. */
export type LocalPolygon = readonly Ring[];

export interface Prism {
  readonly polygons: readonly LocalPolygon[];
  readonly baseY: number;
  readonly topY: number;
  readonly wallColour: Rgb;
  readonly roofColour: Rgb;
}

/** Cleans a polygon: outer ring counter-clockwise from above, holes clockwise. */
export function normalisePolygon(polygon: LocalPolygon): Vec2[][] {
  const outer = polygon[0] === undefined ? [] : openRing(polygon[0]);
  if (outer.length < 3) {
    return [];
  }
  const rings: Vec2[][] = [orient(outer, true)];
  for (const hole of polygon.slice(1)) {
    const open = openRing(hole);
    if (open.length >= 3) {
      rings.push(orient(open, false));
    }
  }
  return rings;
}

/** Walls (one quad per ring edge, outward normals) and an earcut roof. Returns triangles added. */
export function extrudePrism(prism: Prism, out: MeshBuffer): number {
  const before = out.triangles;
  if (prism.topY <= prism.baseY) {
    return 0;
  }
  for (const polygon of prism.polygons) {
    const rings = normalisePolygon(polygon);
    if (rings.length === 0) {
      continue;
    }
    for (const ring of rings) {
      addWalls(ring, prism.baseY, prism.topY, prism.wallColour, out);
    }
    fillPolygon(rings, prism.topY, prism.roofColour, out);
  }
  return out.triangles - before;
}

function addWalls(ring: readonly Vec2[], y0: number, y1: number, colour: Rgb, out: MeshBuffer): void {
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) {
      continue;
    }
    const normal = [-dz / length, 0, dx / length] as const;
    const p0 = [p[0], y0, p[1]] as const;
    const q0 = [q[0], y0, q[1]] as const;
    const q1 = [q[0], y1, q[1]] as const;
    const p1 = [p[0], y1, p[1]] as const;
    out.triangle(p0, q0, q1, normal, colour);
    out.triangle(p0, q1, p1, normal, colour);
  }
}

/** Triangulates a cleaned polygon (outer ring then holes) as an upward face at height y. */
export function fillPolygon(rings: readonly (readonly Vec2[])[], y: number, colour: Rgb, out: MeshBuffer): void {
  const flat: number[] = [];
  const holes: number[] = [];
  rings.forEach((ring, index) => {
    if (index > 0) {
      holes.push(flat.length / 2);
    }
    for (const [x, z] of ring) {
      flat.push(x, z);
    }
  });
  const indices = earcut(flat, holes.length > 0 ? holes : null, 2);
  const vertex = (i: number): Vec2 => [flat[i * 2]!, flat[i * 2 + 1]!];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    out.upTriangle(vertex(indices[t]!), vertex(indices[t + 1]!), vertex(indices[t + 2]!), y, colour);
  }
}
