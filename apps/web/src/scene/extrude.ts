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

/** Corners that turn more than this get a vertical contour; gentle bends (curved walls) do not. */
export const CREASE_ANGLE_DEG = 30;
const CREASE_COS = Math.cos((CREASE_ANGLE_DEG * Math.PI) / 180);
/** Lifts the base contour just above the road and ground layers so it stays visible. */
export const BASE_LINE_LIFT_M = 0.06;

/**
 * Walls (one quad per ring edge, outward normals) and an earcut roof. When `edges` is
 * given, contour segments are appended to it as x, y, z pairs. Returns triangles added.
 */
export function extrudePrism(prism: Prism, out: MeshBuffer, edges?: number[]): number {
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
      if (edges !== undefined) {
        addPrismEdges(ring, prism.baseY, prism.topY, edges);
      }
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

/** Contour lines of one ring: roof outline, base outline, and verticals at sharp corners. */
export function addPrismEdges(ring: readonly Vec2[], y0: number, y1: number, edges: number[]): void {
  const n = ring.length;
  const base = y0 + BASE_LINE_LIFT_M;
  for (let i = 0; i < n; i += 1) {
    const previous = ring[(i + n - 1) % n]!;
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    edges.push(p[0], y1, p[1], q[0], y1, q[1]);
    edges.push(p[0], base, p[1], q[0], base, q[1]);
    if (isCorner(previous, p, q)) {
      edges.push(p[0], base, p[1], p[0], y1, p[1]);
    }
  }
}

/** Whether the outline turns at `b` by more than {@link CREASE_ANGLE_DEG}. */
export function isCorner(a: Vec2, b: Vec2, c: Vec2): boolean {
  const ux = b[0] - a[0];
  const uz = b[1] - a[1];
  const vx = c[0] - b[0];
  const vz = c[1] - b[1];
  const lengths = Math.hypot(ux, uz) * Math.hypot(vx, vz);
  if (lengths < 1e-12) {
    return false;
  }
  return (ux * vx + uz * vz) / lengths < CREASE_COS;
}
