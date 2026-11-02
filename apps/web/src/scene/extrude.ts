import earcut from 'earcut';
import { type MeshBuffer, type Ring, type Vec2, type Vec3, isCorner, openRing, orient } from './mesh-buffer.js';
import type { Rgb } from './palette.js';
import { MAX_GABLE_WALL_M, addGableRoof, gableCorners } from './roof.js';

/** A polygon in local metres: outer ring first, then holes. */
export type LocalPolygon = readonly Ring[];

export interface Prism {
  readonly polygons: readonly LocalPolygon[];
  readonly baseY: number;
  readonly topY: number;
  readonly wallColour: Rgb;
  readonly roofColour: Rgb;
  /** When set, small rectangular low buildings get a pitched roof in this colour. */
  readonly tileColour?: Rgb;
  readonly windowSlotM?: number;
  /** Window floor datum, style index and seed; the datum can sit above a buried foundation. */
  readonly facadeLayout?: Vec3;
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

/** Lifts the base contour just above the road and ground layers so it stays visible. */
export const BASE_LINE_LIFT_M = 0.06;

/** Windows are laid out in slots at least this wide; a shorter wall has none. */
export const WINDOW_SLOT_M = 3.2;

/**
 * Walls (one quad per ring edge, outward normals) and a roof: a pitched roof for small
 * rectangular low buildings when the prism has a tile colour, otherwise an earcut flat
 * roof. When `edges` is given, contour segments are appended to it as x, y, z pairs.
 * Returns triangles added.
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
      addWalls(ring, prism, out);
      if (edges !== undefined) {
        addPrismEdges(ring, prism.baseY, prism.topY, edges);
      }
    }
    const gable = pitchedRoofCorners(prism, rings);
    if (gable !== undefined && prism.tileColour !== undefined) {
      addGableRoof(gable, prism.topY, prism.wallColour, prism.tileColour, out, edges);
    } else {
      fillPolygon(rings, prism.topY, prism.roofColour, out);
    }
  }
  return out.triangles - before;
}

function pitchedRoofCorners(prism: Prism, rings: readonly Vec2[][]): ReturnType<typeof gableCorners> {
  if (prism.tileColour === undefined || rings.length !== 1 || prism.topY - prism.baseY > MAX_GABLE_WALL_M) {
    return undefined;
  }
  return gableCorners(rings[0]!);
}

function addWalls(ring: readonly Vec2[], prism: Prism, out: MeshBuffer): void {
  const { baseY: y0, topY: y1, wallColour: colour } = prism;
  const height = y1 - y0;
  const layout: Vec3 = prism.facadeLayout ?? [y0, 0, 0];
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
    // Window slots: u runs 0..n along the wall so each window sits centred in its slot.
    const slots = Math.floor(length / (prism.windowSlotM ?? WINDOW_SLOT_M));
    const slotWidth = slots > 0 ? length / slots : 0;
    const fp0: Vec3 = [0, height, slotWidth];
    const fq0: Vec3 = [slots, height, slotWidth];
    const fq1: Vec3 = [slots, 0, slotWidth];
    const fp1: Vec3 = [0, 0, slotWidth];
    out.triangle(p0, q0, q1, normal, colour, [fp0, fq0, fq1], layout);
    out.triangle(p0, q1, p1, normal, colour, [fp0, fq1, fp1], layout);
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
    edges.push(p[0], y1, p[1], q[0], y1, q[1], p[0], base, p[1], q[0], base, q[1]);
    if (isCorner(previous, p, q)) {
      edges.push(p[0], base, p[1], p[0], y1, p[1]);
    }
  }
}
